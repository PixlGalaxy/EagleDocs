import { hostname } from 'os';
import type { EnvConfig } from '../config/env.js';
import type { Db } from '../db/pool.js';
import { logger } from '../logger.js';

const HEARTBEAT_MS = 15_000;
/** A node silent for longer than this counts as offline. */
export const NODE_OFFLINE_SECONDS = 60;

/** Registers this replica in `nodes` and keeps its heartbeat fresh. */
export async function startHeartbeat(db: Db, config: EnvConfig): Promise<void> {
  await db.query(
    `INSERT INTO nodes (id, hostname, version, started_at, heartbeat_at) VALUES ($1, $2, $3, now(), now())
     ON CONFLICT (id) DO UPDATE SET hostname = excluded.hostname, version = excluded.version,
       started_at = excluded.started_at, heartbeat_at = excluded.heartbeat_at`,
    [config.NODE_ID, hostname(), config.BACKEND_VERSION],
  );
  setInterval(() => {
    db.query('UPDATE nodes SET heartbeat_at = now() WHERE id = $1', [config.NODE_ID]).catch((err: Error) =>
      logger.warn(`Heartbeat failed: ${err.message}`),
    );
  }, HEARTBEAT_MS).unref();
}

/** Leader task: forgets nodes that have been offline for a day. */
export async function pruneNodes(db: Db): Promise<void> {
  await db.query("DELETE FROM nodes WHERE heartbeat_at < now() - interval '1 day'");
}
