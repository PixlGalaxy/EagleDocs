import pg from 'pg';
import type { EnvConfig } from '../config/env.js';
import { logger } from '../logger.js';

// bigint (COUNT, SUM) as a JS number: our counts never come near 2^53.
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));
// numeric (CPU cores, prices) as a number too.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value) => Number(value));

/** Anything that runs a query: the pool, or a client inside a transaction. */
export type Queryable = Pick<pg.Pool, 'query'> | pg.PoolClient;

export type Db = pg.Pool;

export function createPool(config: EnvConfig): Db {
  const pool = new pg.Pool({
    connectionString: config.DATABASE_URL,
    max: config.DB_POOL_MAX,
    ssl: config.DB_SSL ? { rejectUnauthorized: false } : undefined,
    application_name: `eagledocs:${config.NODE_ID}`,
  });
  // An idle client losing its connection (DB restart, failover) must not crash
  // the process; the pool drops it and opens a new one on the next query.
  pool.on('error', (err) => logger.error('Idle database client error', err));
  return pool;
}

/** All rows. */
export async function many<T>(db: Queryable, sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await db.query(sql, params);
  return result.rows as T[];
}

/** The first row, or undefined. */
export async function maybe<T>(db: Queryable, sql: string, params: unknown[] = []): Promise<T | undefined> {
  const result = await db.query(sql, params);
  return result.rows[0] as T | undefined;
}

/** The first row; throws when there is none (a bug, not a 404). */
export async function one<T>(db: Queryable, sql: string, params: unknown[] = []): Promise<T> {
  const row = await maybe<T>(db, sql, params);
  if (row === undefined) throw new Error(`Expected a row from: ${sql.slice(0, 80)}`);
  return row;
}

/** Runs a statement and returns how many rows it touched. */
export async function exec(db: Queryable, sql: string, params: unknown[] = []): Promise<number> {
  const result = await db.query(sql, params);
  return result.rowCount ?? 0;
}
