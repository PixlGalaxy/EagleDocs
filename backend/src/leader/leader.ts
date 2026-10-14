import type { Db } from '../db/pool.js';
import { logger } from '../logger.js';

/**
 * Runs `fn` only if no other replica is running it right now, using a
 * session-level `pg_try_advisory_lock`. Returns false when another replica
 * had the lock. The lock is released when `fn` ends, so the next cycle may
 * land on any replica; that is fine for idempotent periodic work.
 */
export async function runExclusive(db: Db, lockId: number, fn: () => Promise<void>): Promise<boolean> {
  const client = await db.connect();
  try {
    const { rows } = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1) AS locked', [lockId]);
    if (!rows[0]?.locked) return false;
    try {
      await fn();
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [lockId]);
    }
    return true;
  } finally {
    client.release();
  }
}

/** Schedules `fn` every `intervalMs` on whichever replica gets the lock first. Runs once soon after boot too. */
export function scheduleExclusive(db: Db, name: string, lockId: number, intervalMs: number, fn: () => Promise<void>): void {
  const tick = () =>
    runExclusive(db, lockId, fn).catch((err) => logger.error(`Scheduled task "${name}" failed`, err));
  // A small random delay keeps replicas that boot together from racing on the first tick.
  setTimeout(() => void tick(), 5_000 + Math.random() * 5_000).unref();
  setInterval(() => void tick(), intervalMs).unref();
}
