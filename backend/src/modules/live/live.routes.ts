import { Router, type NextFunction, type Response } from 'express';
import type { Bus } from '../../bus/bus.js';
import type { AppRequest } from '../../types/index.js';
import { requireAuth } from '../auth/session.middleware.js';

/** Keeps the stream alive through proxies that drop idle connections (Cloudflare: 100 s). */
const HEARTBEAT_MS = 25_000;
/**
 * The change reaches the tabs after every replica had time to reload its settings cache
 * (it reloads on the same NOTIFY), so the config they fetch next is already the new one.
 */
const SETTLE_MS = 1_000;

/**
 * Live updates for open tabs: when an admin saves anything, every signed-in tab on every
 * replica re-reads what it shows (runtime config, its user, the models) without a reload.
 * The event carries no data; the tabs fetch it through their own authorized requests.
 */
export function createLiveRoutes(bus: Bus) {
  const streams = new Set<Response>();
  let pending: NodeJS.Timeout | null = null;

  void bus.on('admin_changed', () => {
    if (pending) return;
    pending = setTimeout(() => {
      pending = null;
      for (const res of streams) res.write('event: admin_changed\ndata: {}\n\n');
    }, SETTLE_MS);
    pending.unref();
  });

  /** On /api/admin: a successful write tells every replica. */
  const announce = (req: AppRequest, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
      res.on('finish', () => {
        if (res.statusCode < 400 && req.user?.role === 'admin') void bus.publish('admin_changed', {}).catch(() => undefined);
      });
    }
    next();
  };

  const router = Router();
  router.get('/', requireAuth, (req: AppRequest, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 5000\n\n');
    streams.add(res);
    const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
    req.on('close', () => {
      clearInterval(heartbeat);
      streams.delete(res);
    });
  });

  return { router, announce };
}
