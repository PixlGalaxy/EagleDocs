import { isIP } from 'net';
import type { NextFunction, Request, Response } from 'express';
import type { Db } from '../db/pool.js';
import { tooManyRequests } from '../errors.js';
import { logger } from '../logger.js';

export interface HitResult {
  allowed: boolean;
  count: number;
  retryAfterSeconds: number;
}

/**
 * Fixed-window counter in `rate_limits`, shared by every replica. One atomic
 * upsert per hit, so two replicas counting the same key never lose an update.
 */
export async function hitRateLimit(db: Db, key: string, windowMs: number, max: number): Promise<HitResult> {
  const now = Date.now();
  const windowStart = new Date(Math.floor(now / windowMs) * windowMs);
  const { rows } = await db.query<{ count: number }>(
    `INSERT INTO rate_limits (key, window_start, count) VALUES ($1, $2, 1)
     ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1
     RETURNING count`,
    [key, windowStart],
  );
  const count = rows[0]!.count;
  return {
    allowed: count <= max,
    count,
    retryAfterSeconds: Math.max(1, Math.ceil((windowStart.getTime() + windowMs - now) / 1000)),
  };
}

/** Clears a key's counters early, e.g. after a successful login. */
export async function clearRateLimit(db: Db, key: string): Promise<void> {
  await db.query('DELETE FROM rate_limits WHERE key = $1', [key]);
}

/** Leader task: windows older than a day are never read again. */
export async function pruneRateLimits(db: Db): Promise<void> {
  await db.query("DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'");
}

/**
 * The bucket an address counts in. One IPv6 client usually holds a whole /64,
 * so it counts as one; IPv4 (also IPv4-mapped IPv6) counts per address.
 */
export function ipBucket(ip: string | undefined): string {
  if (!ip) return 'unknown';
  if (ip.toLowerCase().startsWith('::ffff:') && isIP(ip.slice(7)) === 4) return ip.slice(7);
  if (isIP(ip) !== 6) return ip;
  const [head = '', tail = ''] = ip.toLowerCase().split('%')[0]!.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...h, ...Array<string>(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t] : h;
  return `${groups.slice(0, 4).map((g) => g.padStart(4, '0')).join(':')}::/64`;
}

interface RateLimiterOptions {
  windowMs: number;
  max: number;
  /** Bucket key for this request; null skips limiting it (e.g. body field missing). */
  keyFn: (req: Request) => string | null;
  /** Logged when a key gets blocked. */
  describe: (req: Request) => string;
}

/** Counts every request regardless of outcome, so it caps guessing even before a handler runs. */
export function createRateLimiter(db: Db, options: RateLimiterOptions) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const key = options.keyFn(req);
    if (key === null) return next();
    try {
      const result = await hitRateLimit(db, key, options.windowMs, options.max);
      if (!result.allowed) {
        if (result.count === options.max + 1) logger.auth.warn(`Rate limit exceeded: ${options.describe(req)}`);
        return next(tooManyRequests(result.retryAfterSeconds));
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}
