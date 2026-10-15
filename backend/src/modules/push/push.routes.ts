import { Router } from 'express';
import type { Db } from '../../db/pool.js';
import { maybe } from '../../db/pool.js';
import type { SettingsService } from '../../db/settings.js';
import { badRequest } from '../../errors.js';
import { createRateLimiter } from '../../middleware/rate-limit.js';
import type { Translate } from '../../i18n/index.js';
import type { AppRequest } from '../../types/index.js';
import { requireAdmin, requireAuth } from '../auth/session.middleware.js';
import { SETTINGS_KEYS as K } from '../admin/settings-keys.js';
import { PUSH_KINDS, type PushKind, type PushService } from './push.service.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function str(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function kindsOf(value: unknown): PushKind[] {
  const list = Array.isArray(value) ? value : PUSH_KINDS;
  return PUSH_KINDS.filter((kind) => list.includes(kind));
}

/** Settings → Notifications (every user) and Admin → Push. */
export function createPushRoutes(deps: { db: Db; push: PushService; settings: SettingsService; t: Translate }) {
  const { db, push, settings, t } = deps;
  const user = Router();
  const admin = Router();
  user.use(requireAuth);
  const perUser = (name: string, max: number) =>
    createRateLimiter(db, { windowMs: 60 * 60_000, max, keyFn: (req) => `push:${name}:${(req as AppRequest).user!.id}`, describe: (req) => `push ${name} by "${(req as AppRequest).user!.username}"` });
  admin.use(requireAdmin);

  user.post('/subscriptions', perUser('subscribe', 30), async (req: AppRequest, res) => {
    const body = (req.body ?? {}) as { subscription?: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }; kinds?: unknown };
    const endpoint = str(body.subscription?.endpoint, 2000);
    const p256dh = str(body.subscription?.keys?.p256dh, 200);
    const auth = str(body.subscription?.keys?.auth, 100);
    if (!push.isValidEndpoint(endpoint) || !p256dh || !auth) throw badRequest('push.invalidSubscription');
    await push.subscribe(req.user!.id, { endpoint, keys: { p256dh, auth } }, kindsOf(body.kinds));
    res.status(204).end();
  });

  user.post('/unsubscribe', async (req: AppRequest, res) => {
    await push.unsubscribe(req.user!.id, str((req.body as { endpoint?: unknown })?.endpoint, 2000));
    res.status(204).end();
  });

  user.post('/test', perUser('test', 20), async (req: AppRequest, res) => {
    const lang = req.user!.language;
    const sent = await push.notify(
      req.user!.id,
      { kind: 'test', title: t('pushMsg.testTitle', lang), body: t('pushMsg.testBody', lang), url: '/settings?section=notifications', tag: 'test' },
      { anyKind: true },
    );
    res.json({ sent });
  });

  const view = async () => ({
    vapid_public_key: push.publicKey(),
    subscriptions: await push.subscriptions(),
    contact_email: push.contactEmail(),
  });

  admin.get('/push', async (_req, res) => res.json(await view()));

  admin.put('/push', async (req: AppRequest, res) => {
    const email = str((req.body as { contact_email?: unknown })?.contact_email, 200);
    if (email && !EMAIL.test(email)) throw badRequest('push.invalidEmail');
    await settings.set(K.pushContactEmail, email);
    res.json(await view());
  });

  admin.post('/push/vapid', async (_req, res) => {
    await push.regenerate();
    res.json(await view());
  });

  admin.post('/push/broadcast', async (req: AppRequest, res) => {
    const body = (req.body ?? {}) as { title?: unknown; body?: unknown; url?: unknown; institution_id?: unknown };
    const title = str(body.title, 120);
    const text = str(body.body, 500);
    const url = str(body.url, 500);
    const institutionId = typeof body.institution_id === 'string' && body.institution_id ? body.institution_id : null;
    if (!title) throw badRequest('push.titleRequired');
    // Only links inside the app or to the web, never javascript: and the like.
    if (url && !/^(\/(?!\/)|https?:\/\/)/i.test(url)) throw badRequest('push.invalidUrl');
    if (institutionId && !(await maybe(db, 'SELECT 1 FROM institutions WHERE id = $1', [institutionId]))) throw badRequest('push.invalidUrl');
    const { rows } = await db.query<{ id: string }>(
      'INSERT INTO broadcasts (title, body, url, institution_id, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [title, text, url || null, institutionId, req.user!.id],
    );
    const sent = await push.broadcast(institutionId, { kind: 'broadcast', title, body: text, url: url || '/chat', tag: `broadcast-${rows[0]!.id}` });
    await db.query('UPDATE broadcasts SET sent = $2 WHERE id = $1', [rows[0]!.id, sent]);
    res.json({ sent });
  });

  return { user, admin };
}

/** The newest announcement of the last week the visitor should see (the app shows it as a banner). */
export function latestBroadcast(db: Db, institutionId: string | null) {
  return maybe<{ id: string; title: string; body: string; url: string | null }>(
    db,
    `SELECT id, title, body, url FROM broadcasts
     WHERE created_at > now() - interval '7 days' AND (institution_id IS NULL OR institution_id = $1)
     ORDER BY created_at DESC LIMIT 1`,
    [institutionId],
  );
}
