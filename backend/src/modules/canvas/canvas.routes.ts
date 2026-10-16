import { Router } from 'express';
import { badRequest, notFound } from '../../errors.js';
import { logger } from '../../logger.js';
import { routeParam } from '../../route-params.js';
import type { AppRequest } from '../../types/index.js';
import { requireAuth } from '../auth/session.middleware.js';
import { toView, type ConnectionsService } from '../connections/connections.service.js';
import type { CanvasService } from './canvas.service.js';
import type { CourseSpaces } from './course-spaces.js';

/** The Courses page (read-only Canvas views) and the Canvas/SSO/Degree Works cards in Settings -> Connections. */
export function createCanvasRoutes(canvas: CanvasService, connections: ConnectionsService, spaces: CourseSpaces) {
  const canvasRouter = Router();
  const connectionRouter = Router();
  canvasRouter.use(requireAuth);
  connectionRouter.use(requireAuth);

  canvasRouter.get('/courses', async (req: AppRequest, res) => {
    const courses = await canvas.courses(req.user!.id);
    // This term's courses carry their workspace folder (laid out if missing), for "Open folder".
    const folders = new Map((await spaces.ensure(req.user!.id).catch(() => [])).map((s) => [s.id, s.folder]));
    res.json(courses.map((c) => (folders.has(c.id) ? { ...c, folder: folders.get(c.id) } : c)));
  });

  canvasRouter.get('/upcoming', async (req: AppRequest, res) => {
    const days = Math.min(60, Math.max(1, Number(req.query.days) || 14));
    res.json(await canvas.upcoming(req.user!.id, days));
  });

  canvasRouter.get('/courses/:id', async (req: AppRequest, res) => {
    const id = Number(routeParam(req.params.id));
    if (!Number.isInteger(id) || id <= 0) throw notFound();
    res.json(await canvas.course(req.user!.id, id));
  });

  /** Drops the cache so the next view reads fresh from Canvas. */
  canvasRouter.post('/refresh', (req: AppRequest, res) => {
    canvas.forget(req.user!.id);
    res.status(204).end();
  });

  connectionRouter.put('/canvas', async (req: AppRequest, res) => {
    const body = (req.body ?? {}) as { token?: unknown; base_url?: unknown };
    const token = typeof body.token === 'string' ? body.token.trim() : '';
    if (token.length < 20 || token.length > 300 || /\s/.test(token)) throw badRequest('canvas.tokenFormat');
    let baseUrl: string | undefined;
    if (typeof body.base_url === 'string' && body.base_url.trim()) {
      try {
        const url = new URL(body.base_url.trim());
        if (url.protocol !== 'https:') throw new Error('https only');
        baseUrl = url.origin;
      } catch {
        throw badRequest('canvas.noBaseUrl');
      }
    }
    const row = await canvas.saveToken(req.user!.id, token, baseUrl);
    logger.system.info(`"${req.user!.username}" connected Canvas`);
    // Each current course gets its workspace folder right away.
    void spaces.ensure(req.user!.id).catch((err: Error) => logger.warn(`Course folders after connecting Canvas: ${err.message}`));
    res.json(toView(row));
  });

  connectionRouter.put('/sso', async (req: AppRequest, res) => {
    const row = await connections.saveSso(req.user!.id, (req.body ?? {}) as Record<string, unknown>);
    logger.system.info(`"${req.user!.username}" saved their school account`);
    res.json(toView(row));
  });

  connectionRouter.put('/degreeworks', async (req: AppRequest, res) => {
    const enabled = (req.body as { enabled?: unknown })?.enabled === true;
    res.json(toView(await connections.setDegreeWorks(req.user!.id, enabled)));
  });

  return { canvasRouter, connectionRouter };
}
