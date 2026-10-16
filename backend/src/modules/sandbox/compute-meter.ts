import type { Db } from '../../db/pool.js';
import { many } from '../../db/pool.js';
import { logger } from '../../logger.js';
import type { DockerClient } from './docker.js';

/** One Compute Unit: one core busy for an hour. */
export const CU_MS = 3_600_000;

/** The two limit windows. Each starts with the first use after the previous one ended (like Claude's). */
export const WINDOWS = { day: 24 * 3_600_000, week: 7 * 24 * 3_600_000 } as const;
export type WindowKind = keyof typeof WINDOWS;

export interface WindowStatus {
  /** Units used in the window that is running; 0 when none is. */
  usedCu: number;
  /** Units the plan includes in this window; null = unlimited. */
  limitCu: number | null;
  /** When the running window ends; null when none is (the next use starts one). */
  resetsAt: string | null;
}

export interface ComputeStatus {
  day: WindowStatus;
  week: WindowStatus;
  /** Past a limit: the sandbox runs at `throttleCpu` cores until that window ends. */
  throttled: boolean;
  throttleCpu: number;
}

export interface ComputePlan {
  computeUnitsDaily: number;
  computeUnitsWeekly: number;
  cpu: number;
}

interface Meterable {
  userId: string;
  containerId: string;
}

const round = (cu: number) => Math.round(cu * 1000) / 1000;

/**
 * Counts each sandbox's real CPU time (the container's cgroup counter, read from
 * Docker) into the student's day and week windows (and usage_daily for the
 * history), and slows a sandbox down while a window is over its plan's units,
 * instead of stopping their work.
 */
export class ComputeMeter {
  /** Last CPU counter read per container (ns). A new container starts at 0. */
  private last = new Map<string, number>();
  private throttled = new Set<string>();

  constructor(
    private db: Db,
    private docker: DockerClient,
    private planOf: (userId: string) => Promise<ComputePlan>,
    private throttleCpu: () => number,
  ) {}

  /** The student's windows right now, whether or not their sandbox runs. */
  async status(userId: string, containerId?: string): Promise<ComputeStatus> {
    const [rows, plan] = await Promise.all([
      many<{ kind: WindowKind; started_at: Date; used_ms: string }>(this.db, 'SELECT kind, started_at, used_ms FROM compute_windows WHERE user_id = $1', [userId]),
      this.planOf(userId),
    ]);
    const now = Date.now();
    const window = (kind: WindowKind, limit: number): WindowStatus => {
      const row = rows.find((r) => r.kind === kind);
      const ends = row ? row.started_at.getTime() + WINDOWS[kind] : 0;
      const running = row && ends > now;
      return { usedCu: running ? round(Number(row.used_ms) / CU_MS) : 0, limitCu: limit > 0 ? limit : null, resetsAt: running ? new Date(ends).toISOString() : null };
    };
    const day = window('day', plan.computeUnitsDaily);
    const week = window('week', plan.computeUnitsWeekly);
    const over = [day, week].some((w) => w.limitCu !== null && w.usedCu >= w.limitCu);
    return { day, week, throttled: containerId ? this.throttled.has(containerId) : over, throttleCpu: this.throttleCpu() };
  }

  /** Whether a sandbox starting now should start slowed down. */
  async overLimit(userId: string): Promise<boolean> {
    const s = await this.status(userId);
    return [s.day, s.week].some((w) => w.limitCu !== null && w.usedCu >= w.limitCu);
  }

  /** A container that started slowed down. */
  markThrottled(containerId: string): void {
    this.throttled.add(containerId);
  }

  /** Adds CPU time to the history and to both windows; an ended window starts over with this use. */
  private async record(userId: string, ms: number): Promise<void> {
    await this.db.query(
      `INSERT INTO usage_daily (user_id, day, compute_ms) VALUES ($1, current_date, $2)
       ON CONFLICT (user_id, day) DO UPDATE SET compute_ms = usage_daily.compute_ms + excluded.compute_ms`,
      [userId, ms],
    );
    for (const [kind, length] of Object.entries(WINDOWS)) {
      await this.db.query(
        `INSERT INTO compute_windows (user_id, kind, started_at, used_ms) VALUES ($1, $2, now(), $3)
         ON CONFLICT (user_id, kind) DO UPDATE SET
           started_at = CASE WHEN compute_windows.started_at + make_interval(secs => $4::double precision / 1000) <= now() THEN now() ELSE compute_windows.started_at END,
           used_ms = CASE WHEN compute_windows.started_at + make_interval(secs => $4::double precision / 1000) <= now() THEN excluded.used_ms ELSE compute_windows.used_ms + excluded.used_ms END`,
        [userId, kind, ms, length],
      );
    }
  }

  /** Counts the CPU time since the last read, then slows or restores the sandbox to match the plan. */
  async sample(handle: Meterable): Promise<void> {
    const total = await this.docker.cpuTotal(handle.containerId);
    if (total === null) return;
    const before = this.last.get(handle.containerId) ?? 0;
    this.last.set(handle.containerId, total);
    const ms = Math.max(0, Math.round((total - before) / 1e6));
    if (ms > 0) await this.record(handle.userId, ms);
    await this.enforce(handle);
  }

  private async enforce(handle: Meterable): Promise<void> {
    const over = await this.overLimit(handle.userId);
    const slow = this.throttled.has(handle.containerId);
    if (over === slow) return;
    const plan = await this.planOf(handle.userId);
    const cpu = over ? Math.min(this.throttleCpu(), plan.cpu) : plan.cpu;
    await this.docker.update(handle.containerId, { NanoCpus: Math.round(cpu * 1e9) });
    if (over) this.throttled.add(handle.containerId);
    else this.throttled.delete(handle.containerId);
    logger.info(`Sandbox of ${handle.userId} ${over ? `slowed to ${cpu} cores (compute units used up)` : 'back to full speed'}`);
  }

  /** Every running sandbox on this replica, one after the other. */
  async tick(handles: Meterable[]): Promise<void> {
    for (const h of handles) {
      await this.sample(h).catch((err: Error) => logger.warn(`Compute meter for ${h.userId}: ${err.message}`));
    }
  }

  /** The last read before a container goes away, then forgets it. */
  async final(handle: Meterable): Promise<void> {
    await this.sample(handle).catch(() => undefined);
    this.last.delete(handle.containerId);
    this.throttled.delete(handle.containerId);
  }
}
