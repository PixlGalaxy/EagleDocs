import type { Db } from '../../db/pool.js';
import { logBuffer, type LogEntry } from '../../log-buffer.js';

const FLUSH_MS = 1000;
/** While the database is unreachable, keep at most this many lines waiting. */
const MAX_QUEUE = 5000;
const MAX_BATCH = 1000;
/** Rows kept in `app_logs`, across all replicas. */
export const LOG_CAPACITY = 100_000;
const RETENTION_DAYS = 7;

/**
 * Copies this replica's log lines into `app_logs` in batches, so the admin
 * panel shows every replica's logs no matter which one answers. Lines written
 * before the database was ready (boot messages) are shipped too.
 */
export function startLogShipper(db: Db, nodeId: string): () => Promise<void> {
  let queue: LogEntry[] = logBuffer.since(0);
  logBuffer.subscribe((entry) => {
    queue.push(entry);
    if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
  });

  let flushing = false;
  const flush = async () => {
    if (flushing || queue.length === 0) return;
    flushing = true;
    const batch = queue.slice(0, MAX_BATCH);
    try {
      await db.query(
        `INSERT INTO app_logs (node_id, time, channel, level, message)
         SELECT $1, * FROM unnest($2::timestamptz[], $3::text[], $4::text[], $5::text[])`,
        [
          nodeId,
          batch.map((e) => e.time),
          batch.map((e) => e.channel),
          batch.map((e) => e.level),
          batch.map((e) => e.message.slice(0, 4000)),
        ],
      );
      queue = queue.slice(batch.length);
    } catch {
      // Not logged on purpose: the error line would queue itself. The batch stays and is retried.
    } finally {
      flushing = false;
    }
  };
  setInterval(() => void flush(), FLUSH_MS).unref();
  // For shutdown: wait out a flush in progress, then send what is left.
  return async () => {
    while (flushing) await new Promise((resolve) => setTimeout(resolve, 50));
    await flush();
  };
}

/** Leader task: keeps the table bounded by age and by size. */
export async function pruneLogs(db: Db): Promise<void> {
  await db.query('DELETE FROM app_logs WHERE time < now() - make_interval(days => $1)', [RETENTION_DAYS]);
  await db.query(
    `DELETE FROM app_logs WHERE id < (SELECT id FROM app_logs ORDER BY id DESC OFFSET $1 LIMIT 1)`,
    [LOG_CAPACITY],
  );
}

/** Newest line this node already stored per file-fed channel, so a restarted backend resumes the files where it left off. */
export async function lastShippedFileLines(db: Db, nodeId: string): Promise<Partial<Record<'FRONTEND' | 'ENTRYPOINT', Date>>> {
  const { rows } = await db.query<{ channel: 'FRONTEND' | 'ENTRYPOINT'; time: Date }>(
    `SELECT channel, MAX(time) AS time FROM app_logs WHERE node_id = $1 AND channel IN ('FRONTEND', 'ENTRYPOINT') GROUP BY channel`,
    [nodeId],
  );
  return Object.fromEntries(rows.map((row) => [row.channel, row.time]));
}
