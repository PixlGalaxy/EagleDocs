import { Router } from 'express';
import busboy from 'busboy';
import { RAG_DIR, UserRags } from 'pixlai-engine';
import { badRequest, notFound, withDetail } from '../../errors.js';
import { routeParam } from '../../route-params.js';
import type { AppRequest } from '../../types/index.js';
import { requireAuth } from '../auth/session.middleware.js';
import { IMAGE_TYPES } from '../chat/attachments.js';
import { QuotaError, TEMP, TEMP_TTL_MS, type DiskWorkspace } from '../../engine/workspace.js';

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const MB = 1048576;

function pathParam(value: unknown): string {
  const path = typeof value === 'string' ? value.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') : '';
  if (path === RAG_DIR || path.startsWith(`${RAG_DIR}/`)) throw notFound();
  return path;
}

/** Workspace errors (bad path, missing file, quota) as clean 4xx answers. */
function asHttp(err: unknown): never {
  if (err instanceof QuotaError) throw withDetail(badRequest('files.quota'), err.message);
  const message = (err as Error).message ?? '';
  if (/Not found|Not a folder|is a folder/.test(message)) throw notFound();
  if (/Invalid path|Links are not allowed|Cannot (delete|move) a root/.test(message)) throw badRequest('files.invalidPath');
  throw err;
}

/** The Files page and Settings -> RAGs: the same files the agent works with. */
export function createFilesRoutes(workspace: DiskWorkspace) {
  const files = Router();
  const rags = Router();
  files.use(requireAuth);
  rags.use(requireAuth);

  const usage = async (userId: string) => {
    const [ws, temp] = await workspace.usage(userId);
    return {
      usage: { used_mb: Math.round(ws!.usedBytes / MB), limit_mb: Math.round(ws!.limitBytes / MB) },
      temp: { used_mb: Math.round(temp!.usedBytes / MB), limit_mb: Math.round(temp!.limitBytes / MB), ttl_hours: TEMP_TTL_MS / 3_600_000 },
    };
  };

  files.get('/', async (req: AppRequest, res) => {
    const userId = req.user!.id;
    const path = pathParam(req.query.path);
    const entries = await workspace.list(userId, path).catch(asHttp);
    res.json({
      entries: entries
        .filter((e) => e.path !== RAG_DIR)
        .map((e) => ({ name: e.name, path: e.path, type: e.type, size: e.size, modified_at: e.modifiedAt, ...(e.path === TEMP && { temp: true }) })),
      ...(await usage(userId)),
    });
  });

  files.post('/mkdir', async (req: AppRequest, res) => {
    const path = pathParam((req.body as { path?: unknown })?.path);
    if (!path || !/^[^<>:"|?*\u0000-\u001f]+$/.test(path)) throw badRequest('files.invalidPath');
    await workspace.mkdir(req.user!.id, path).catch(asHttp);
    res.status(201).end();
  });

  files.delete('/', async (req: AppRequest, res) => {
    const path = pathParam(req.query.path);
    if (!path || path === TEMP) throw badRequest('files.invalidPath');
    await workspace.delete(req.user!.id, path).catch(asHttp);
    res.status(204).end();
  });

  files.get('/download', async (req: AppRequest, res, next) => {
    const path = pathParam(req.query.path);
    const stat = await workspace.stat(req.user!.id, path).catch(asHttp);
    if (!stat || stat.type !== 'file') throw notFound();
    const { abs } = workspace.resolve(req.user!.id, path);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Pictures may show inline (chat thumbnails), with their own type and a sandbox: nothing can run from them.
    const inlineType = req.query.inline === '1' ? IMAGE_TYPES[stat.name.split('.').pop()?.toLowerCase() ?? ''] : undefined;
    if (inlineType) {
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.type(inlineType).sendFile(abs, { dotfiles: 'allow' }, (err) => {
        if (err && !res.headersSent) next(notFound());
      });
      return;
    }
    // Everything else as a download: user files must never render as pages on our origin.
    res.download(abs, stat.name, { dotfiles: 'allow' }, (err) => {
      if (err && !res.headersSent) next(notFound());
    });
  });

  files.post('/upload', (req: AppRequest, res, next) => {
    const dir = (() => {
      try {
        return pathParam(req.query.path);
      } catch (err) {
        return err as Error;
      }
    })();
    if (dir instanceof Error) return next(dir);
    const parser = busboy({ headers: req.headers, limits: { files: 1, fileSize: MAX_UPLOAD_BYTES + 1 } });
    let job: Promise<unknown> | null = null;
    let failure: unknown = null;
    parser.on('file', (_field, stream, info) => {
      const name = (info.filename ?? 'upload').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').slice(0, 150) || 'upload';
      const path = dir ? `${dir}/${name}` : name;
      job = workspace
        .writeStream(req.user!.id, path, stream, MAX_UPLOAD_BYTES)
        .then(async () => {
          const stat = await workspace.stat(req.user!.id, path);
          return { name: stat!.name, path: stat!.path, type: 'file', size: stat!.size, modified_at: stat!.modifiedAt };
        })
        .catch((err) => {
          failure = err;
          stream.resume();
        });
    });
    parser.on('error', (err) => {
      failure ??= err;
    });
    parser.on('close', () => {
      void (async () => {
        if (!job) return next(badRequest('avatars.noFile'));
        const entry = await job;
        if (failure) return next(failure instanceof QuotaError ? withDetail(badRequest('files.quota'), failure.message) : failure);
        res.status(201).json(entry);
      })().catch(next);
    });
    req.pipe(parser);
  });

  // ---------------------------------------------------------------- RAGs (Settings)

  rags.get('/', async (req: AppRequest, res) => {
    const userId = req.user!.id;
    const list = await new UserRags(workspace, userId).list();
    const out = [];
    for (const m of list) {
      let bytes = 0;
      for (const file of ['manifest.json', 'chunks.jsonl', 'vectors.f32']) {
        bytes += (await workspace.stat(userId, `${RAG_DIR}/${m.id}/${file}`))?.size ?? 0;
      }
      out.push({
        id: m.id,
        name: m.name,
        description: m.description,
        model: m.model,
        chunks: m.sources.reduce((n, s) => n + s.chunks, 0),
        sources: m.sources.map((s) => ({ path: s.path, pages: s.pages, chunks: s.chunks, added_at: s.addedAt })),
        size_mb: Math.round((bytes / MB) * 10) / 10,
        created_at: m.createdAt,
        updated_at: m.updatedAt,
      });
    }
    res.json(out);
  });

  rags.delete('/:id', async (req: AppRequest, res) => {
    const id = routeParam(req.params.id);
    if (!/^[a-z0-9-]{1,48}$/.test(id)) throw notFound();
    await new UserRags(workspace, req.user!.id).remove(id).catch(() => {
      throw notFound();
    });
    res.status(204).end();
  });

  return { files, rags };
}
