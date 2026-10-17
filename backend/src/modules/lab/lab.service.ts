import { basename } from 'path';
import type pg from 'pg';
import type { Bus } from '../../bus/bus.js';
import type { Db } from '../../db/pool.js';
import { many, maybe } from '../../db/pool.js';
import type { SettingsService } from '../../db/settings.js';
import type { DiskWorkspace } from '../../engine/workspace.js';
import { logger } from '../../logger.js';
import { SETTINGS_KEYS as K } from '../admin/settings-keys.js';
import type { TiersService } from '../billing/tiers.service.js';
import { WINDOWS, type WindowKind, type WindowStatus } from '../sandbox/compute-meter.js';
import { ollamaChat, transcribe, type Segment } from './backends.js';

/** One Accelerator Unit: one minute of GPU time. */
export const AU_MS = 60_000;
/** Whichever replica holds this advisory lock runs the GPU worker (one per cluster). */
const WORKER_LOCK = 0x1ab0_0001;
const LEAD_EVERY_MS = 10_000;
/** A missed NOTIFY never strands a waiter or the worker for long. */
const POLL_MS = 5_000;
/** Finished tasks are kept this long (results are copied into the workspace by the tools). */
const KEEP_MS = 24 * 3_600_000;
const DEFAULT_MAX_QUEUED = 200;

export type LabKind = 'vision' | 'text' | 'transcribe';
/** 0 = interactive (one picture in a chat), 1 = batch (a lecture cut in pieces). */
export type LabPriority = 0 | 1;

export interface VisionInput {
  prompt: string;
  /** A workspace picture, or the picture itself (base64) for one that is not saved. */
  path?: string;
  data?: string;
}
export interface TextInput {
  prompt: string;
  system?: string;
}
export interface TranscribeInput {
  /** A workspace audio file (the tools cut long recordings into pieces first). */
  path: string;
  language?: string;
}
export interface LabOutputs {
  vision: { text: string };
  text: { text: string };
  transcribe: { text: string; segments: Segment[]; language: string | null };
}
type Inputs = { vision: VisionInput; text: TextInput; transcribe: TranscribeInput };

interface TaskRow {
  id: string;
  user_id: string;
  kind: LabKind;
  model: string;
  input: Record<string, unknown>;
  status: 'queued' | 'running' | 'done' | 'failed';
  output: unknown;
  error: string | null;
}

export interface LabStatus {
  day: WindowStatus;
  week: WindowStatus;
  /** A window is used up: no new tasks until it ends. */
  over: boolean;
  /** Which kinds of work the Lab can do right now (admin switch and servers set). */
  available: Record<LabKind, boolean>;
}

/** What a student sees (and the agent is told) when the Lab cannot take more work. */
export class LabError extends Error {}

const round = (au: number) => Math.round(au * 1000) / 1000;
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => (clearTimeout(timer), resolve()), { once: true });
  });

/**
 * The Accelerator Lab: GPU work (pictures, text, speech) in one fair queue, run by a single worker
 * in the whole cluster, one task at a time, and counted in Accelerator Units per student.
 * Tools call `run`, which queues a task and waits for its result; long jobs queue many small tasks.
 */
export class LabService {
  private waiters = new Map<string, () => void>();
  private leader: pg.PoolClient | null = null;
  private wakeWorker: (() => void) | null = null;
  /** The model the GPU ran last: the queue prefers it to save a reload. */
  private loadedModel = '';
  private timers: NodeJS.Timeout[] = [];
  private stopped = false;
  /** A task is on the GPU right now. */
  private busy = false;

  constructor(
    private db: Db,
    private bus: Bus,
    private settings: SettingsService,
    private tiers: TiersService,
    private workspace: DiskWorkspace,
    private nodeId: string,
  ) {}

  async start(): Promise<void> {
    await this.bus.on('lab_done', ({ taskId }) => this.waiters.get(taskId)?.());
    await this.bus.on('lab_queued', () => this.wakeWorker?.());
    this.timers.push(setInterval(() => void this.lead(), LEAD_EVERY_MS).unref(), setInterval(() => void this.cleanup(), 3_600_000).unref());
    void this.lead();
  }

  /**
   * On shutdown: lets the worker lock go after the task on the GPU ends (or at once if idle), so
   * another replica takes the queue within seconds instead of after the connection times out.
   */
  async stop(): Promise<void> {
    this.stopped = true;
    for (const timer of this.timers) clearInterval(timer);
    const leader = this.leader;
    this.leader = null;
    this.wakeWorker?.();
    while (this.busy) await sleep(100);
    if (leader) {
      await leader.query('SELECT pg_advisory_unlock($1)', [WORKER_LOCK]).catch(() => undefined);
      leader.release();
    }
  }

  /** The model a kind of work uses; null when the admin has not set it up. */
  private modelFor(kind: LabKind): { url: string; model: string } | null {
    if (!this.settings.getBoolean(K.labEnabled, false)) return null;
    const ollama = this.settings.getString(K.labOllamaUrl, '').trim();
    if (kind === 'transcribe') {
      const url = this.settings.getString(K.labWhisperUrl, '').trim();
      return url ? { url, model: this.settings.getString(K.labWhisperModel, '').trim() || 'whisper-1' } : null;
    }
    const model = this.settings.getString(kind === 'vision' ? K.labVisionModel : K.labTextModel, '').trim();
    return ollama && model ? { url: ollama, model } : null;
  }

  available(kind: LabKind): boolean {
    return this.modelFor(kind) !== null;
  }

  // ------------------------------------------------------------------ Accelerator Units

  async status(userId: string): Promise<LabStatus> {
    const [rows, plan] = await Promise.all([
      many<{ kind: WindowKind; started_at: Date; used_ms: string }>(this.db, 'SELECT kind, started_at, used_ms FROM lab_windows WHERE user_id = $1', [userId]),
      this.tiers.limitsFor(userId),
    ]);
    const now = Date.now();
    const window = (kind: WindowKind, limit: number): WindowStatus => {
      const row = rows.find((r) => r.kind === kind);
      const ends = row ? row.started_at.getTime() + WINDOWS[kind] : 0;
      const running = row && ends > now;
      return { usedCu: running ? round(Number(row.used_ms) / AU_MS) : 0, limitCu: limit > 0 ? limit : null, resetsAt: running ? new Date(ends).toISOString() : null };
    };
    const day = window('day', plan.acceleratorUnitsDaily);
    const week = window('week', plan.acceleratorUnitsWeekly);
    return {
      day,
      week,
      over: [day, week].some((w) => w.limitCu !== null && w.usedCu >= w.limitCu),
      available: { vision: this.available('vision'), text: this.available('text'), transcribe: this.available('transcribe') },
    };
  }

  /** Adds GPU time to the history and both windows; an ended window starts over with this use. */
  private async record(userId: string, ms: number): Promise<void> {
    await this.db.query(
      `INSERT INTO usage_daily (user_id, day, lab_ms) VALUES ($1, current_date, $2)
       ON CONFLICT (user_id, day) DO UPDATE SET lab_ms = usage_daily.lab_ms + excluded.lab_ms`,
      [userId, ms],
    );
    for (const [kind, length] of Object.entries(WINDOWS)) {
      await this.db.query(
        `INSERT INTO lab_windows (user_id, kind, started_at, used_ms) VALUES ($1, $2, now(), $3)
         ON CONFLICT (user_id, kind) DO UPDATE SET
           started_at = CASE WHEN lab_windows.started_at + make_interval(secs => $4::double precision / 1000) <= now() THEN now() ELSE lab_windows.started_at END,
           used_ms = CASE WHEN lab_windows.started_at + make_interval(secs => $4::double precision / 1000) <= now() THEN excluded.used_ms ELSE lab_windows.used_ms + excluded.used_ms END`,
        [userId, kind, ms, length],
      );
    }
  }

  // ------------------------------------------------------------------ queueing

  /** Queues one task after checking the switch, the student's units and their queue. */
  async submit<T extends LabKind>(userId: string, kind: T, input: Inputs[T], priority: LabPriority = 1): Promise<string> {
    const target = this.modelFor(kind);
    if (!target) throw new LabError(`The Accelerator Lab cannot do ${kind === 'transcribe' ? 'transcription' : kind === 'vision' ? 'pictures' : 'text work'} on this server (an administrator has not set it up).`);
    const status = await this.status(userId);
    if (status.over) {
      const window = [status.day, status.week].find((w) => w.limitCu !== null && w.usedCu >= w.limitCu)!;
      throw new LabError(`The student's Accelerator Units are used up (${window.usedCu} of ${window.limitCu} AU); they come back ${window.resetsAt ? `at ${window.resetsAt}` : 'soon'}.`);
    }
    const max = this.settings.getNumber(K.labMaxQueued, DEFAULT_MAX_QUEUED);
    const queued = await maybe<{ n: number }>(this.db, "SELECT COUNT(*)::int AS n FROM lab_tasks WHERE user_id = $1 AND status IN ('queued', 'running')", [userId]);
    if ((queued?.n ?? 0) >= max) throw new LabError(`The student already has ${max} Accelerator Lab tasks waiting; wait for those to finish.`);
    const row = await maybe<{ id: string }>(
      this.db,
      'INSERT INTO lab_tasks (user_id, kind, priority, model, input) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [userId, kind, priority, target.model, JSON.stringify(input)],
    );
    await this.bus.publish('lab_queued', { taskId: row!.id });
    return row!.id;
  }

  /** Waits for a task's result. Giving up (abort) withdraws it if it has not started. */
  async wait<T extends LabKind>(taskId: string, signal?: AbortSignal): Promise<LabOutputs[T]> {
    for (;;) {
      const task = await maybe<Pick<TaskRow, 'status' | 'output' | 'error'>>(this.db, 'SELECT status, output, error FROM lab_tasks WHERE id = $1', [taskId]);
      if (!task) throw new LabError('The Accelerator Lab task disappeared');
      if (task.status === 'done') return task.output as LabOutputs[T];
      if (task.status === 'failed') throw new LabError(task.error ?? 'The Accelerator Lab task failed');
      if (signal?.aborted) {
        await this.db.query("DELETE FROM lab_tasks WHERE id = $1 AND status = 'queued'", [taskId]);
        throw new LabError('Stopped while waiting for the Accelerator Lab');
      }
      await new Promise<void>((resolve) => {
        const done = () => (clearTimeout(timer), this.waiters.delete(taskId), resolve());
        const timer = setTimeout(done, POLL_MS);
        this.waiters.set(taskId, done);
        signal?.addEventListener('abort', done, { once: true });
      });
    }
  }

  /** Withdraws tasks that have not started (a job stopped, or failed half-way through queueing). */
  async withdraw(taskIds: string[]): Promise<void> {
    if (taskIds.length) await this.db.query("DELETE FROM lab_tasks WHERE id = ANY($1::uuid[]) AND status = 'queued'", [taskIds]);
  }

  /** AU the student can still use now: the smaller room left in the day and week windows (null = unlimited). */
  async room(userId: string): Promise<number | null> {
    const s = await this.status(userId);
    const left = [s.day, s.week].filter((w) => w.limitCu !== null).map((w) => Math.max(0, w.limitCu! - w.usedCu));
    return left.length ? Math.min(...left) : null;
  }

  /** Queues a task and waits for its result. */
  async run<T extends LabKind>(userId: string, kind: T, input: Inputs[T], options: { priority?: LabPriority; signal?: AbortSignal } = {}): Promise<LabOutputs[T]> {
    const id = await this.submit(userId, kind, input, options.priority ?? 1);
    return this.wait<T>(id, options.signal);
  }

  /** Tasks ahead of this student's next one, for "you are number N in line". */
  async ahead(userId: string): Promise<number> {
    const row = await maybe<{ n: number }>(
      this.db,
      `SELECT COUNT(*)::int AS n FROM lab_tasks WHERE status IN ('queued', 'running') AND user_id <> $1
         AND created_at <= COALESCE((SELECT min(created_at) FROM lab_tasks WHERE user_id = $1 AND status = 'queued'), now())`,
      [userId],
    );
    return row?.n ?? 0;
  }

  // ------------------------------------------------------------------ the worker (one per cluster)

  /** Takes the worker's lock if nobody has it; checks a held lock is still alive. */
  private async lead(): Promise<void> {
    if (this.stopped) return;
    if (this.leader) {
      await this.leader.query('SELECT 1').catch(() => this.dropLeader(this.leader!));
      return;
    }
    let client: pg.PoolClient | null = null;
    try {
      client = await this.db.connect();
      const { rows } = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1) AS locked', [WORKER_LOCK]);
      if (!rows[0]?.locked) return client.release();
      // A dropped connection loses the lock; the next check notices (an unheard error would end the process).
      client.on('error', (err) => {
        logger.warn(`Accelerator Lab: worker lock connection error: ${err.message}`);
        this.dropLeader(client!);
      });
      this.leader = client;
      client = null;
      // Whatever was running belonged to a worker that is gone.
      await this.db.query("UPDATE lab_tasks SET status = 'queued', started_at = NULL, node_id = NULL WHERE status = 'running'");
      logger.info(`Accelerator Lab worker running on ${this.nodeId}`);
      void this.work();
    } catch (err) {
      client?.release();
      logger.warn(`Accelerator Lab: could not take the worker lock: ${(err as Error).message}`);
    }
  }

  /** The lock went with its connection: stop working (another replica may already have it). */
  private dropLeader(client: pg.PoolClient): void {
    if (this.leader !== client) return;
    logger.warn('Accelerator Lab: lost the worker lock');
    this.leader = null;
    this.wakeWorker?.();
    client.release(true);
  }

  private async work(): Promise<void> {
    while (this.leader) {
      const leader = this.leader;
      // Claimed over the lock's own connection: if the lock is gone, so is the claim.
      const task = await this.claim(leader).catch((err: Error) => {
        logger.warn(`Accelerator Lab: could not read the queue: ${err.message}`);
        this.dropLeader(leader);
        return null;
      });
      if (!task) {
        await new Promise<void>((resolve) => {
          this.wakeWorker = resolve;
          setTimeout(resolve, POLL_MS * 6).unref();
        });
        this.wakeWorker = null;
        continue;
      }
      this.busy = true;
      try {
        await this.execute(task);
      } finally {
        this.busy = false;
      }
    }
  }

  /**
   * The next task: interactive before batch, then the student served longest ago (round-robin, so one
   * long lecture never blocks everyone), then the model already loaded, then the oldest.
   */
  private async claim(leader: pg.PoolClient): Promise<TaskRow | null> {
    const row = await maybe<TaskRow>(
      leader,
      `WITH next AS (
         SELECT t.id FROM lab_tasks t
         LEFT JOIN LATERAL (SELECT max(s.started_at) AS last FROM lab_tasks s WHERE s.user_id = t.user_id) u ON true
         WHERE t.status = 'queued'
         ORDER BY t.priority, u.last NULLS FIRST, (t.model = $2) DESC, t.created_at
         LIMIT 1
       )
       UPDATE lab_tasks SET status = 'running', started_at = now(), node_id = $1
       FROM next WHERE lab_tasks.id = next.id AND lab_tasks.status = 'queued'
       RETURNING lab_tasks.id, lab_tasks.user_id, lab_tasks.kind, lab_tasks.model, lab_tasks.input, lab_tasks.status, lab_tasks.output, lab_tasks.error`,
      [this.nodeId, this.loadedModel],
    );
    return row ?? null;
  }

  private async execute(task: TaskRow): Promise<void> {
    const started = Date.now();
    let output: unknown = null;
    let error: string | null = null;
    try {
      output = await this.perform(task);
    } catch (err) {
      error = (err as Error).message.slice(0, 500);
    }
    const ms = Date.now() - started;
    this.loadedModel = task.model;
    // The picture itself is not kept once the task ran.
    await this.db.query(
      `UPDATE lab_tasks SET status = $2, output = $3, error = $4, gpu_ms = $5, finished_at = now(), input = input - 'data' WHERE id = $1`,
      [task.id, error ? 'failed' : 'done', output === null ? null : JSON.stringify(output), error, ms],
    );
    await this.record(task.user_id, ms).catch((err: Error) => logger.warn(`Accelerator Lab: could not count units: ${err.message}`));
    await this.bus.publish('lab_done', { taskId: task.id });
  }

  private async perform(task: TaskRow): Promise<unknown> {
    const target = this.modelFor(task.kind);
    if (!target) throw new Error('The Accelerator Lab was turned off or is not set up for this kind of work');
    if (task.kind === 'vision') {
      const input = task.input as unknown as VisionInput;
      const image = input.data ?? (input.path ? (await this.workspace.read(task.user_id, input.path)).toString('base64') : null);
      if (!image) throw new Error('No picture to look at');
      return { text: await ollamaChat(target.url, target.model, input.prompt, { images: [image] }) };
    }
    if (task.kind === 'text') {
      const input = task.input as unknown as TextInput;
      return { text: await ollamaChat(target.url, target.model, input.prompt, { system: input.system, numCtx: 16_384 }) };
    }
    const input = task.input as unknown as TranscribeInput;
    const audio = await this.workspace.read(task.user_id, input.path);
    return transcribe(target.url, target.model, audio, basename(input.path), { language: input.language });
  }

  private async cleanup(): Promise<void> {
    await this.db
      .query("DELETE FROM lab_tasks WHERE status IN ('done', 'failed') AND finished_at < now() - make_interval(secs => $1)", [KEEP_MS / 1000])
      .catch(() => undefined);
  }
}
