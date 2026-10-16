import { Router } from 'express';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import type { Db } from '../../db/pool.js';
import type { DiskWorkspace } from '../../engine/workspace.js';
import { logger } from '../../logger.js';
import { createRateLimiter } from '../../middleware/rate-limit.js';
import type { AppRequest } from '../../types/index.js';
import { requireAuth } from '../auth/session.middleware.js';
import { ExportService } from './export.service.js';
import { zipStream } from './zip-stream.js';

/**
 * GET /api/account/export: the signed-in student's data as one ZIP, streamed straight to the browser
 * (Settings → Account, and the account deletion screen). A closed tab stops the walk and closes the open file.
 */
export function createExportRoutes(deps: { db: Db; workspace: DiskWorkspace }) {
  const service = new ExportService(deps.db, deps.workspace);
  const router = Router();
  router.use(requireAuth);
  // An export reads the whole workspace: a few per hour is plenty.
  const limiter = createRateLimiter(deps.db, {
    windowMs: 60 * 60 * 1000,
    max: 3,
    keyFn: (req) => ((req as AppRequest).user ? `export:${(req as AppRequest).user!.id}` : null),
    describe: (req) => `data exports by "${(req as AppRequest).user?.username}"`,
  });

  router.get('/', limiter, async (req: AppRequest, res) => {
    const user = req.user!;
    const now = new Date();
    const data = await service.collect(user.id);
    res.status(200).set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="studyhawk-export-${now.toISOString().slice(0, 10)}.zip"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      // Straight through the bundled nginx, not buffered to its temp files.
      'X-Accel-Buffering': 'no',
    });
    const started = Date.now();
    let bytes = 0;
    const zip = Readable.from(
      (async function* () {
        for await (const chunk of zipStream(service.entries(user.id, data, now))) {
          bytes += chunk.length;
          yield chunk;
        }
      })(),
      { objectMode: false },
    );
    try {
      await pipeline(zip, res);
      logger.info(`Data export for ${user.username}: ${(bytes / 1024 / 1024).toFixed(1)} MB in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    } catch (err) {
      // The browser went away (or a read failed): the walk stops and the connection is dropped, so no
      // half-written archive ever looks complete.
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ERR_STREAM_PREMATURE_CLOSE') logger.info(`Data export for ${user.username} cancelled after ${(bytes / 1024 / 1024).toFixed(1)} MB`);
      else logger.warn(`Data export for ${user.username} failed: ${(err as Error).message}`);
      res.destroy();
    }
  });

  return router;
}
