import { Router } from 'express';
import type { Db } from '../../db/pool.js';
import { many, one } from '../../db/pool.js';
import { LOG_CHANNELS, type LogChannel } from '../../log-buffer.js';
import { requireAdmin } from '../auth/session.middleware.js';
import { LOG_CAPACITY } from './log-shipper.js';

const PAGE_SIZES = [100, 200, 1000];
const POLL_MS = 1000;

interface Row {
  id: number;
  node_id: string;
  time: Date;
  channel: LogChannel;
  level: 'INFO' | 'WARN' | 'ERROR';
  message: string;
}

const positiveInt = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : fallback;
};

/** Optional filters shared by the page and the stream: node, channel, minimum level. */
function filters(query: Record<string, unknown>, params: unknown[]): string {
  const where: string[] = [];
  if (typeof query.node === 'string' && query.node) {
    params.push(query.node);
    where.push(`node_id = $${params.length}`);
  }
  if (typeof query.channel === 'string' && LOG_CHANNELS.includes(query.channel as LogChannel)) {
    params.push(query.channel);
    where.push(`channel = $${params.length}`);
  }
  if (query.level === 'warn') where.push(`level IN ('WARN', 'ERROR')`);
  if (query.level === 'error') where.push(`level = 'ERROR'`);
  return where.length ? `WHERE ${where.join(' AND ')}` : '';
}

const toEntry = (row: Row) => ({ ...row, time: row.time.toISOString() });

/** Cluster-wide logs from `app_logs`; every replica can answer. */
export function createLogsRoutes(db: Db): Router {
  const router = Router();
  router.use(requireAdmin);

  router.get('/', async (req, res) => {
    const requested = positiveInt(req.query.limit, PAGE_SIZES[0]!);
    const limit = PAGE_SIZES.includes(requested) ? requested : PAGE_SIZES[0]!;
    const page = positiveInt(req.query.page, 1);

    const params: unknown[] = [];
    const where = filters(req.query, params);
    const { total } = await one<{ total: number }>(db, `SELECT COUNT(*) AS total FROM app_logs ${where}`, params);
    const rows = await many<Row>(
      db,
      `SELECT id, node_id, time, channel, level, message FROM app_logs ${where}
       ORDER BY id DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
      params,
    );
    const nodes = await many<{ node_id: string }>(db, 'SELECT DISTINCT node_id FROM app_logs ORDER BY node_id');

    res.json({
      entries: rows.map(toEntry),
      total,
      pages: Math.max(1, Math.ceil(total / limit)),
      limit,
      capacity: LOG_CAPACITY,
      nodes: nodes.map((n) => n.node_id),
    });
  });

  /**
   * Server-sent events: entries newer than `after`, polled from the table so
   * lines written by any replica show up, batched once a second.
   */
  router.get('/stream', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 5000\n\n');

    let after = Number(req.query.after) || 0;
    let busy = false;
    let closed = false;
    const poll = async () => {
      if (busy || closed) return;
      busy = true;
      try {
        const params: unknown[] = [after];
        const where = filters(req.query, params);
        const rows = await many<Row>(
          db,
          `SELECT id, node_id, time, channel, level, message FROM app_logs
           ${where ? `${where} AND` : 'WHERE'} id > $1 ORDER BY id LIMIT 500`,
          params,
        );
        if (rows.length > 0 && !closed) {
          after = rows[rows.length - 1]!.id;
          res.write(`data: ${JSON.stringify(rows.map(toEntry))}\n\n`);
        }
      } catch {
        // The database blipped; the next tick tries again.
      } finally {
        busy = false;
      }
    };

    const timer = setInterval(() => void poll(), POLL_MS);
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 30_000);
    req.on('close', () => {
      closed = true;
      clearInterval(timer);
      clearInterval(heartbeat);
    });
  });

  return router;
}
