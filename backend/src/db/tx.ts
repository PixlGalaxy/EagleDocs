import type pg from 'pg';
import type { Db } from './pool.js';

/** Runs `fn` inside BEGIN/COMMIT on one client, rolling back if it throws. */
export async function withTx<T>(db: Db, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Advisory lock ids. Postgres takes a bigint; these are fixed so every replica
 * agrees on them. Keep them unique across the codebase.
 */
export const LOCKS = {
  migrations: 7_301_001,
  bootstrap: 7_301_002,
  pendingCleanup: 7_301_003,
  housekeeping: 7_301_004,
  scheduler: 7_301_005,
  jobReaper: 7_301_006,
  tempSweep: 7_301_007,
} as const;

/**
 * Holds a session-level advisory lock for the duration of `fn`, waiting for it
 * if another replica has it. Used where every replica must run the work, but
 * one at a time (migrations, admin bootstrap).
 */
export async function withAdvisoryLock<T>(db: Db, lockId: number, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [lockId]);
    try {
      return await fn(client);
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [lockId]);
    }
  } finally {
    client.release();
  }
}
