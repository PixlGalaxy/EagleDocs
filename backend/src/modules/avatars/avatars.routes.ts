import { Router } from 'express';
import { createWriteStream, promises as fs, mkdirSync } from 'fs';
import { join } from 'path';
import { pipeline } from 'stream/promises';
import busboy from 'busboy';
import type { Db } from '../../db/pool.js';
import { maybe } from '../../db/pool.js';
import { badRequest, notFound } from '../../errors.js';
import { routeParam } from '../../route-params.js';
import type { AppRequest } from '../../types/index.js';
import { requireAuth } from '../auth/session.middleware.js';
import { getUserById, toPublicUser } from '../users/users.service.js';

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const UUID = /^[0-9a-f-]{36}$/i;

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
const MIME_BY_EXT: Record<string, string> = Object.fromEntries(Object.entries(EXT_BY_MIME).map(([mime, ext]) => [ext, mime]));

/** Avatars live on the shared storage, so every replica serves the same file. */
export function createAvatarsRoutes(db: Db, avatarsDir: string): Router {
  mkdirSync(avatarsDir, { recursive: true });
  const router = Router();
  const pathOf = (filename: string) => join(avatarsDir, filename);

  const currentFile = async (userId: string) => {
    const row = await maybe<{ avatar_path: string | null }>(db, 'SELECT avatar_path FROM users WHERE id = $1', [userId]);
    if (!row) throw notFound();
    return row.avatar_path;
  };

  router.use(requireAuth);

  // Any signed-in user may fetch any user's avatar (navbar, admin list...).
  router.get('/:userId', async (req: AppRequest, res, next) => {
    const userId = routeParam(req.params.userId);
    if (!UUID.test(userId)) throw notFound();
    const filename = await currentFile(userId);
    if (!filename) throw notFound();
    const ext = filename.split('.').pop() ?? '';
    res.setHeader('Content-Type', MIME_BY_EXT[ext] ?? 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Revalidate every time: the client cache-busts with ?v=<updated_at> instead.
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(pathOf(filename), { dotfiles: 'deny' }, (err) => {
      if (err && !res.headersSent) next(notFound());
    });
  });

  router.post('/', (req: AppRequest, res, next) => {
    const userId = req.user!.id;
    const parser = busboy({ headers: req.headers, limits: { files: 1, fileSize: MAX_AVATAR_BYTES } });

    let sawFile = false;
    let failure: unknown = null;
    let partial = '';
    let filename = '';
    let write: Promise<void> = Promise.resolve();

    parser.on('file', (_field, stream, info) => {
      sawFile = true;
      const ext = EXT_BY_MIME[info.mimeType];
      if (!ext) {
        failure = badRequest('avatars.invalidType');
        stream.resume();
        return;
      }
      filename = `${userId}.${ext}`;
      partial = `${pathOf(filename)}.${process.pid}.part`;

      // busboy stops the stream once fileSize is hit but still ends it "cleanly".
      let truncated = false;
      stream.on('limit', () => {
        truncated = true;
        failure ??= badRequest('avatars.tooLarge');
      });
      write = pipeline(stream, createWriteStream(partial))
        .then(async () => {
          if (truncated) throw failure;
          await fs.rename(partial, pathOf(filename));
        })
        .catch((err) => {
          failure ??= err;
        });
    });

    parser.on('error', (err) => {
      failure ??= err;
    });

    parser.on('close', () => {
      void (async () => {
        await write;
        if (!sawFile) return next(badRequest('avatars.noFile'));
        if (failure) {
          if (partial) await fs.rm(partial, { force: true }).catch(() => undefined);
          return next(failure);
        }
        const previous = await currentFile(userId);
        if (previous && previous !== filename) await fs.rm(pathOf(previous), { force: true }).catch(() => undefined);
        await db.query('UPDATE users SET avatar_path = $1, updated_at = now() WHERE id = $2', [filename, userId]);
        res.json(toPublicUser((await getUserById(db, userId))!));
      })().catch(next);
    });

    req.pipe(parser);
  });

  router.delete('/', async (req: AppRequest, res) => {
    const userId = req.user!.id;
    const previous = await currentFile(userId);
    if (previous) await fs.rm(pathOf(previous), { force: true }).catch(() => undefined);
    await db.query('UPDATE users SET avatar_path = NULL, updated_at = now() WHERE id = $1', [userId]);
    res.json(toPublicUser((await getUserById(db, userId))!));
  });

  return router;
}
