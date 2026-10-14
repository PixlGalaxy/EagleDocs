import { randomBytes, createHash } from 'node:crypto';
import { existsSync, promises as fs } from 'node:fs';
import { hostname } from 'node:os';
import { join, posix } from 'node:path';
import type { Bus } from '../../bus/bus.js';
import type { EnvConfig } from '../../config/env.js';
import type { Db } from '../../db/pool.js';
import { maybe } from '../../db/pool.js';
import type { SettingsService } from '../../db/settings.js';
import { LOCKS } from '../../db/tx.js';
import { logger } from '../../logger.js';
import { NODE_OFFLINE_SECONDS } from '../../nodes/nodes.js';
import { SETTINGS_KEYS as K } from '../admin/settings-keys.js';
import { DockerClient } from './docker.js';

const MB = 1024 * 1024;
const RUNNER_PORT = 7070;
const HEALTH_TIMEOUT_MS = 30_000;
const SLOT_WAIT_MS = 120_000;
const MIGRATE_WAIT_MS = 30_000;
const REAP_EVERY_MS = 60_000;
/** last_active_at is written at most this often per sandbox. */
const TOUCH_DB_MS = 60_000;

export class SandboxBusyError extends Error {}

/** A running sandbox on this replica. */
export interface SandboxHandle {
  userId: string;
  containerId: string;
  name: string;
  baseUrl: string;
  token: string;
  lastUsed: number;
}

export interface SandboxLimits {
  image: string;
  cpu: number;
  memMb: number;
  maxActive: number;
  idleMinutes: number;
}

/** Two 32-bit halves for pg_advisory_lock(int, int): one lock per user. */
function userLockKey(userId: string): number {
  return createHash('sha1').update(userId).digest().readInt32BE(0);
}

/**
 * One container per user across the cluster, started on demand and removed
 * when idle. The workspace and TEMP folders on shared storage are mounted at
 * /workspace and /workspace/TEMP, so the sandbox sees exactly the files the
 * Files page and the file tools see. A row in `sandboxes` says which replica
 * owns a user's container; a job that lands elsewhere asks the owner to stop
 * it (NOTIFY) and starts one locally.
 */
export class SandboxManager {
  private local = new Map<string, SandboxHandle>();
  private starting = new Map<string, Promise<SandboxHandle>>();
  private lastDbTouch = new Map<string, number>();
  /** Docker answered at startup and the image is there. */
  enabled = false;
  /** Backend inside a container: reach sandboxes by name on the shared network. Outside: published loopback ports. */
  private insideDocker = existsSync('/.dockerenv');

  constructor(
    private db: Db,
    private bus: Bus,
    private settings: SettingsService,
    private config: EnvConfig,
    readonly docker = new DockerClient(),
  ) {}

  limits(): SandboxLimits {
    return {
      image: this.settings.getString(K.sandboxImage, this.config.SANDBOX_IMAGE),
      cpu: Math.min(8, Math.max(0.1, this.settings.getNumber(K.sandboxCpu, 1))),
      memMb: Math.min(16384, Math.max(256, this.settings.getNumber(K.sandboxMemMb, 1024))),
      maxActive: Math.max(1, this.settings.getNumber(K.sandboxMaxActive, 4)),
      idleMinutes: Math.max(1, this.settings.getNumber(K.sandboxIdleMinutes, 15)),
    };
  }

  async start(): Promise<void> {
    if (!this.config.SANDBOX_ENABLED) {
      logger.info('Sandboxes are disabled (SANDBOX_ENABLED=false): code and browser tools are off');
      return;
    }
    // Docker Desktop and freshly booted hosts can take a few seconds to answer.
    let reachable = false;
    for (let attempt = 0; attempt < 5 && !reachable; attempt++) {
      reachable = await this.docker.ping();
      if (!reachable) await new Promise((r) => setTimeout(r, 4000));
    }
    if (!reachable) {
      logger.warn('Docker is not reachable: code and browser tools are off. Mount /var/run/docker.sock to enable sandboxes.');
      return;
    }
    const { image } = this.limits();
    if (!(await this.docker.imageExists(image))) {
      logger.info(`Pulling the sandbox image ${image}...`);
      try {
        await this.docker.pull(image);
      } catch (err) {
        logger.warn(`Could not pull ${image}: ${(err as Error).message}. Code and browser tools are off.`);
        return;
      }
    }
    await this.docker.ensureNetwork(this.config.SANDBOX_NETWORK);
    if (this.insideDocker) await this.docker.connect(this.config.SANDBOX_NETWORK, hostname());
    await this.reconcile();
    await this.bus.on('sandbox_control', ({ userId, action }) => {
      if (action === 'stop' && this.local.has(userId)) void this.stop(userId, 'requested by another replica');
    });
    setInterval(() => void this.reapIdle(), REAP_EVERY_MS).unref();
    this.enabled = true;
    logger.info(`Sandboxes ready (image ${image}, network ${this.config.SANDBOX_NETWORK})`);
  }

  /** After a restart this replica owns no live sandbox: remove its leftovers and their rows. */
  private async reconcile(): Promise<void> {
    const leftovers = await this.docker.list(['eagledocs.sandbox=1', `eagledocs.node=${this.config.NODE_ID}`]);
    for (const c of leftovers) await this.docker.remove(c.Id).catch(() => undefined);
    const { rowCount } = await this.db.query('DELETE FROM sandboxes WHERE node_id = $1', [this.config.NODE_ID]);
    if (leftovers.length || rowCount) logger.info(`Removed ${leftovers.length} leftover sandbox container(s) from a previous run`);
  }

  /** The user's sandbox on this replica, starting it (or moving it here) when needed. */
  async ensure(userId: string): Promise<SandboxHandle> {
    if (!this.enabled) throw new Error('Sandboxes are not available on this server');
    const existing = this.local.get(userId);
    if (existing) {
      existing.lastUsed = Date.now();
      return existing;
    }
    let pending = this.starting.get(userId);
    if (!pending) {
      pending = this.startLocked(userId).finally(() => this.starting.delete(userId));
      this.starting.set(userId, pending);
    }
    return pending;
  }

  /** Marks activity (the idle reaper and the admin list use it). */
  touch(handle: SandboxHandle): void {
    handle.lastUsed = Date.now();
    const last = this.lastDbTouch.get(handle.userId) ?? 0;
    if (Date.now() - last > TOUCH_DB_MS) {
      this.lastDbTouch.set(handle.userId, Date.now());
      void this.db.query('UPDATE sandboxes SET last_active_at = now() WHERE user_id = $1', [handle.userId]).catch(() => undefined);
    }
  }

  /** Forgets a sandbox whose container died under us (OOM, Docker restart). */
  forget(userId: string): void {
    const handle = this.local.get(userId);
    if (!handle) return;
    this.local.delete(userId);
    void this.docker.remove(handle.containerId).catch(() => undefined);
    void this.db.query('DELETE FROM sandboxes WHERE user_id = $1 AND node_id = $2', [userId, this.config.NODE_ID]);
  }

  private async startLocked(userId: string): Promise<SandboxHandle> {
    const client = await this.db.connect();
    try {
      // One replica at a time decides about this user's sandbox.
      await client.query('SELECT pg_advisory_lock($1, $2)', [LOCKS.sandboxUser, userLockKey(userId)]);
      try {
        await this.takeOver(userId);
        await this.waitForSlot();
        return await this.create(userId);
      } finally {
        await client.query('SELECT pg_advisory_unlock($1, $2)', [LOCKS.sandboxUser, userLockKey(userId)]);
      }
    } finally {
      client.release();
    }
  }

  /** If another replica runs this user's sandbox, ask it to stop and wait for its row to go. */
  private async takeOver(userId: string): Promise<void> {
    const row = await maybe<{ node_id: string; container_id: string; online: boolean }>(
      this.db,
      `SELECT s.node_id, s.container_id,
                coalesce(n.heartbeat_at > now() - make_interval(secs => $2), false) AS online
           FROM sandboxes s LEFT JOIN nodes n ON n.id = s.node_id
          WHERE s.user_id = $1`,
      [userId, NODE_OFFLINE_SECONDS],
    );
    if (!row) return;
    if (row.node_id === this.config.NODE_ID) {
      // Ours but not in memory (a failed start): clean it.
      await this.docker.remove(row.container_id).catch(() => undefined);
      await this.db.query('DELETE FROM sandboxes WHERE user_id = $1', [userId]);
      return;
    }
    if (row.online) {
      await this.bus.publish('sandbox_control', { userId, action: 'stop' });
      const deadline = Date.now() + MIGRATE_WAIT_MS;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 500));
        const still = await this.db.query('SELECT 1 FROM sandboxes WHERE user_id = $1', [userId]);
        if (!still.rowCount) return;
      }
      logger.warn(`Replica ${row.node_id} did not release the sandbox of ${userId}; taking it over`);
    }
    // Owner offline (or not answering): its replica removes the container when it comes back.
    await this.db.query('DELETE FROM sandboxes WHERE user_id = $1', [userId]);
  }

  private async waitForSlot(): Promise<void> {
    const deadline = Date.now() + SLOT_WAIT_MS;
    while (this.local.size >= this.limits().maxActive) {
      if (Date.now() > deadline) throw new SandboxBusyError('All sandboxes on this server are busy. Try again in a minute.');
      // Free the longest-idle one if it has been quiet for a while, otherwise wait.
      const idlest = [...this.local.values()].sort((a, b) => a.lastUsed - b.lastUsed)[0];
      if (idlest && Date.now() - idlest.lastUsed > 2 * 60_000) await this.stop(idlest.userId, 'making room');
      else await new Promise((r) => setTimeout(r, 1000));
    }
  }

  /** Mount sources for the user's two areas, as the Docker daemon sees them. */
  private async mounts(userId: string): Promise<Record<string, unknown>[]> {
    for (const area of ['workspaces', 'temp']) await fs.mkdir(join(this.config.DATA_ROOT, area, userId), { recursive: true });
    const volume = this.config.SANDBOX_DATA_VOLUME;
    if (volume) {
      return [
        { Type: 'volume', Source: volume, Target: '/workspace', VolumeOptions: { Subpath: `workspaces/${userId}` } },
        { Type: 'volume', Source: volume, Target: '/workspace/TEMP', VolumeOptions: { Subpath: `temp/${userId}` } },
      ];
    }
    const root = this.config.SANDBOX_DATA_HOST_PATH ?? this.config.DATA_ROOT;
    const pathJoin = root.startsWith('/') ? posix.join : join;
    return [
      { Type: 'bind', Source: pathJoin(root, 'workspaces', userId), Target: '/workspace' },
      { Type: 'bind', Source: pathJoin(root, 'temp', userId), Target: '/workspace/TEMP' },
    ];
  }

  /** The sandbox runs as the same user that owns the files the backend writes (never root). */
  private containerUser(): string {
    if (process.platform === 'win32' || typeof process.getuid !== 'function') return '1000:1000';
    const uid = process.getuid();
    return uid === 0 ? '1000:1000' : `${uid}:${process.getgid?.() ?? uid}`;
  }

  private async create(userId: string): Promise<SandboxHandle> {
    const limits = this.limits();
    const token = randomBytes(32).toString('hex');
    const name = `eagledocs-sbx-${userId.slice(0, 8)}-${randomBytes(3).toString('hex')}`;
    const published = !this.insideDocker;
    const started = Date.now();

    const containerId = await this.docker.create(name, {
      Image: limits.image,
      User: this.containerUser(),
      Env: [`RUNNER_TOKEN=${token}`, `RUNNER_PORT=${RUNNER_PORT}`],
      Labels: { 'eagledocs.sandbox': '1', 'eagledocs.user': userId, 'eagledocs.node': this.config.NODE_ID },
      ExposedPorts: { [`${RUNNER_PORT}/tcp`]: {} },
      HostConfig: {
        NanoCpus: Math.round(limits.cpu * 1e9),
        Memory: limits.memMb * MB,
        MemorySwap: limits.memMb * MB,
        PidsLimit: 256,
        ReadonlyRootfs: true,
        Tmpfs: { '/tmp': 'rw,nosuid,nodev,size=256m' },
        ShmSize: 64 * MB,
        CapDrop: ['ALL'],
        SecurityOpt: ['no-new-privileges'],
        Mounts: await this.mounts(userId),
        NetworkMode: this.config.SANDBOX_NETWORK,
        RestartPolicy: { Name: 'no' },
        ...(published && { PortBindings: { [`${RUNNER_PORT}/tcp`]: [{ HostIp: '127.0.0.1', HostPort: '' }] } }),
      },
    });
    await this.db.query(
      `INSERT INTO sandboxes (user_id, node_id, container_id, status, mem_limit_mb)
       VALUES ($1, $2, $3, 'starting', $4)
       ON CONFLICT (user_id) DO UPDATE SET node_id = $2, container_id = $3, status = 'starting', mem_limit_mb = $4,
         started_at = now(), last_active_at = now()`,
      [userId, this.config.NODE_ID, containerId, limits.memMb],
    );
    try {
      await this.docker.start(containerId);
      let baseUrl = `http://${name}:${RUNNER_PORT}`;
      if (published) {
        const info = await this.docker.inspect(containerId);
        const port = info.NetworkSettings.Ports[`${RUNNER_PORT}/tcp`]?.[0]?.HostPort;
        if (!port) throw new Error('The sandbox port was not published');
        baseUrl = `http://127.0.0.1:${port}`;
      }
      await this.waitHealthy(baseUrl, token);
      const handle: SandboxHandle = { userId, containerId, name, baseUrl, token, lastUsed: Date.now() };
      this.local.set(userId, handle);
      await this.db.query(`UPDATE sandboxes SET status = 'running' WHERE user_id = $1`, [userId]);
      logger.info(`Sandbox started for ${userId} in ${Date.now() - started} ms (${this.local.size} active here)`);
      return handle;
    } catch (err) {
      await this.docker.remove(containerId).catch(() => undefined);
      await this.db.query('DELETE FROM sandboxes WHERE user_id = $1 AND container_id = $2', [userId, containerId]);
      throw err;
    }
  }

  private async waitHealthy(baseUrl: string, token: string): Promise<void> {
    const deadline = Date.now() + HEALTH_TIMEOUT_MS;
    let lastError = '';
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${baseUrl}/health`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(2000) });
        if (res.ok) return;
        lastError = `status ${res.status}`;
      } catch (err) {
        lastError = (err as Error).message;
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error(`The sandbox did not start (${lastError})`);
  }

  async stop(userId: string, reason: string): Promise<void> {
    const handle = this.local.get(userId);
    if (!handle) return;
    this.local.delete(userId);
    this.lastDbTouch.delete(userId);
    await this.db.query(`UPDATE sandboxes SET status = 'stopping' WHERE user_id = $1`, [userId]).catch(() => undefined);
    await this.docker.remove(handle.containerId).catch((err) => logger.warn(`Could not remove sandbox ${handle.name}: ${(err as Error).message}`));
    await this.db.query('DELETE FROM sandboxes WHERE user_id = $1 AND container_id = $2', [userId, handle.containerId]);
    logger.info(`Sandbox of ${userId} stopped (${reason})`);
  }

  private async reapIdle(): Promise<void> {
    const idleMs = this.limits().idleMinutes * 60_000;
    for (const handle of [...this.local.values()]) {
      if (Date.now() - handle.lastUsed > idleMs) await this.stop(handle.userId, 'idle').catch(() => undefined);
    }
  }

  /** Stops every local sandbox (shutdown); workspaces stay on disk. */
  async stopAll(): Promise<void> {
    await Promise.all([...this.local.keys()].map((userId) => this.stop(userId, 'shutting down')));
  }

  activeCount(): number {
    return this.local.size;
  }

  /** A sandbox for this user runs on this replica right now. */
  isRunning(userId: string): boolean {
    return this.local.has(userId);
  }

  /** CPU and memory of a local sandbox, for Admin → Sandbox. */
  async stats(userId: string): Promise<{ cpuPercent: number; memMb: number } | null> {
    const handle = this.local.get(userId);
    return handle ? this.docker.stats(handle.containerId).catch(() => null) : null;
  }
}
