import type { Request, Response, NextFunction } from 'express';
import { logger } from '../logger.js';

// Docker's HEALTHCHECK calls /api/health over loopback, straight to the
// backend, so it never carries a forwarded IP. Anyone hitting /api/health from
// outside still shows up with their real IP and gets logged like anything else.
const LOCAL_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  // The log viewer polls this; logging it would feed itself with its own requests.
  if (req.originalUrl.startsWith('/api/admin/logs')) return next();
  if (req.originalUrl === '/api/health' && LOCAL_IPS.has(req.ip ?? '')) return next();

  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
    // The path only: query strings carry file names (?path=), searches (?q=) and one-time tokens.
    const message = `${req.method} ${req.originalUrl.split('?')[0]} ${res.statusCode} ${ms.toFixed(1)}ms`;
    if (res.statusCode >= 500) logger.error(message);
    else if (res.statusCode >= 400) logger.warn(message);
    else logger.info(message);
  });

  next();
}
