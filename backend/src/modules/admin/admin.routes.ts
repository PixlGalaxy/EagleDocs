import { Router } from 'express';
import type { EnvConfig } from '../../config/env.js';
import type { Db } from '../../db/pool.js';
import { many, one } from '../../db/pool.js';
import type { SettingsService } from '../../db/settings.js';
import { badRequest } from '../../errors.js';
import { PAID_SEARCH_PROVIDERS, paidSearch } from '../../engine/web.js';
import { format, isLanguage, type Translate } from '../../i18n/index.js';
import { logger } from '../../logger.js';
import { NODE_OFFLINE_SECONDS } from '../../nodes/nodes.js';
import { routeParam } from '../../route-params.js';
import { THEME_MODES, THEME_SKINS, type AppRequest } from '../../types/index.js';
import { requireAdmin } from '../auth/session.middleware.js';
import { parseInstitutionInput, type InstitutionsService } from '../institutions/institutions.service.js';
import type { MailService } from '../mail/mail.service.js';
import { normalizeEmail } from '../users/users.service.js';
import { SETTINGS_KEYS as K } from './settings-keys.js';
import type { BuiltinSkills } from '../skills/builtin.js';
import type { UsersAdminService } from './users-admin.service.js';

const activePause = (until: string | null) => (until && new Date(until).getTime() > Date.now() ? until : null);

function numberIn(value: unknown, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw badRequest('adminSettings.invalidValue');
  return Math.round(n);
}

function text(value: unknown, max = 200): string {
  if (typeof value !== 'string' || value.length > max) throw badRequest('adminSettings.invalidValue');
  return value.trim();
}

function bool(value: unknown): boolean {
  if (typeof value !== 'boolean') throw badRequest('adminSettings.invalidValue');
  return value;
}

export function createAdminRoutes(deps: {
  db: Db;
  config: EnvConfig;
  settings: SettingsService;
  mail: MailService;
  institutions: InstitutionsService;
  users: UsersAdminService;
  t: Translate;
  builtinSkills: BuiltinSkills;
  /** A plan given by hand applies at once (the plan cache forgets this student). */
  onUserChanged?: (userId: string) => void;
}): Router {
  const { db, config, settings, mail, institutions, users, t, builtinSkills } = deps;
  const startedAt = Date.now();
  const router = Router();
  router.use(requireAdmin);

  const audit = (req: AppRequest, action: string, target: string | null, meta: Record<string, unknown> = {}) =>
    db
      .query('INSERT INTO audit_log (actor_id, action, target, meta) VALUES ($1, $2, $3, $4)', [req.user!.id, action, target, meta])
      .catch((err: Error) => logger.warn(`Audit log write failed: ${err.message}`));

  // ------------------------------------------------------------ dashboard

  router.get('/overview', async (req: AppRequest, res) => {
    const lang = req.lang;
    const counts = await one<{ total: number; active: number; pending: number }>(
      db,
      `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status = 'active') AS active,
         COUNT(*) FILTER (WHERE status = 'pending') AS pending FROM users`,
    );
    const nodes = await one<{ online: number }>(
      db,
      'SELECT COUNT(*) AS online FROM nodes WHERE heartbeat_at > now() - make_interval(secs => $1)',
      [NODE_OFFLINE_SECONDS],
    );
    const institutionCount = await one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM institutions WHERE enabled');

    const models = await one<{ n: number }>(
      db,
      'SELECT COUNT(*) AS n FROM models m JOIN model_endpoints e ON e.id = m.endpoint_id WHERE m.enabled AND e.enabled',
    );
    const jobs = await one<{ running: number; today: number }>(
      db,
      `SELECT COUNT(*) FILTER (WHERE status IN ('running', 'waiting_approval', 'waiting_mfa')) AS running,
         (SELECT COUNT(DISTINCT chat_id) FROM jobs WHERE queued_at > current_date) AS today FROM jobs`,
    );

    const alerts: { level: 'warning' | 'error'; message: string; section?: string }[] = [];
    if (!mail.isConfigured()) alerts.push({ level: 'error', message: t('admin.alertSmtp', lang), section: 'email' });
    if (institutionCount.n === 0) alerts.push({ level: 'warning', message: t('admin.alertNoInstitution', lang), section: 'institutions' });
    if (models.n === 0) alerts.push({ level: 'error', message: t('admin.alertNoModel', lang), section: 'models' });
    const paused = activePause(settings.getJson<string | null>(K.codexDisabledUntil, null));
    if (paused) {
      alerts.push({
        level: 'warning',
        message: format(t('admin.alertCodexPaused', lang), { date: new Date(paused).toLocaleString(lang ?? 'en') }),
        section: 'models',
      });
    }

    res.json({
      users: counts,
      chats_today: jobs.today,
      jobs_running: jobs.running,
      sandboxes_active: (await one<{ n: number }>(db, 'SELECT COUNT(*)::int AS n FROM sandboxes')).n,
      nodes_online: nodes.online,
      alerts,
    });
  });

  /** What is running: versions, this replica, the database and every node. */
  router.get('/system', async (_req, res) => {
    const pgInfo = await one<{ version: string; size: number }>(
      db,
      "SELECT current_setting('server_version') AS version, pg_database_size(current_database()) AS size",
    );
    const migrations = await one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM schema_migrations');
    res.json({
      version: config.BACKEND_VERSION,
      image_ref: config.IMAGE_REF,
      image_revision: config.IMAGE_REVISION ?? null,
      node_id: config.NODE_ID,
      node_version: process.version,
      uptime_seconds: Math.round((Date.now() - startedAt) / 1000),
      memory_mb: Math.round(process.memoryUsage().rss / 1048576),
      database: { version: pgInfo.version, size_mb: Math.round(pgInfo.size / 1048576), migrations: migrations.n },
    });
  });

  router.get('/nodes', async (_req, res) => {
    const rows = await many<{ id: string; hostname: string; version: string; started_at: Date; heartbeat_at: Date; online: boolean }>(
      db,
      `SELECT *, heartbeat_at > now() - make_interval(secs => $1) AS online FROM nodes ORDER BY id`,
      [NODE_OFFLINE_SECONDS],
    );
    const running = await many<{ node_id: string; n: number }>(
      db,
      "SELECT node_id, COUNT(*) AS n FROM jobs WHERE status IN ('running', 'waiting_approval', 'waiting_mfa') GROUP BY node_id",
    );
    const boxes = await many<{ node_id: string; n: number }>(db, 'SELECT node_id, COUNT(*)::int AS n FROM sandboxes GROUP BY node_id');
    res.json(rows.map((row) => ({ ...row, sandboxes_active: boxes.find((b) => b.node_id === row.id)?.n ?? 0, jobs_running: running.find((r) => r.node_id === row.id)?.n ?? 0 })));
  });

  // ------------------------------------------------------------ users

  router.get('/users', async (req, res) => {
    res.json(await users.list(typeof req.query.q === 'string' ? req.query.q : ''));
  });

  router.post('/users', async (req: AppRequest, res) => {
    const created = await users.create((req.body ?? {}) as Record<string, unknown>);
    logger.system.info(`"${req.user!.username}" created user "${created.username}"`);
    await audit(req, 'user.create', created.id, { username: created.username, role: created.role });
    res.status(201).json(created);
  });

  router.patch('/users/:id', async (req: AppRequest, res) => {
    const id = routeParam(req.params.id);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const updated = await users.update(id, req.user!.id, body);
    deps.onUserChanged?.(id);
    logger.system.info(`"${req.user!.username}" updated user "${updated.username}" (${Object.keys(body).join(', ')})`);
    await audit(req, 'user.update', id, { fields: Object.keys(body) });
    res.json(updated);
  });

  router.post('/users/:id/password', async (req: AppRequest, res) => {
    const id = routeParam(req.params.id);
    await users.resetPassword(id, (req.body as { password?: unknown })?.password);
    logger.system.info(`"${req.user!.username}" reset the password of user ${id}`);
    await audit(req, 'user.password', id);
    res.status(204).end();
  });

  router.delete('/users/:id', async (req: AppRequest, res) => {
    const id = routeParam(req.params.id);
    await users.delete(id, req.user!.id);
    logger.system.info(`"${req.user!.username}" deleted user ${id}`);
    await audit(req, 'user.delete', id);
    res.status(204).end();
  });

  // ------------------------------------------------------------ institutions

  router.get('/institutions', async (_req, res) => {
    res.json(await institutions.list());
  });

  router.post('/institutions', async (req: AppRequest, res) => {
    const saved = await institutions.save(null, parseInstitutionInput((req.body ?? {}) as Record<string, unknown>));
    logger.system.info(`"${req.user!.username}" created institution "${saved.name}"`);
    await audit(req, 'institution.create', saved.id, { name: saved.name });
    res.status(201).json(saved);
  });

  router.put('/institutions/:id', async (req: AppRequest, res) => {
    const id = routeParam(req.params.id);
    const saved = await institutions.save(id, parseInstitutionInput((req.body ?? {}) as Record<string, unknown>));
    logger.system.info(`"${req.user!.username}" updated institution "${saved.name}"`);
    await audit(req, 'institution.update', id, { name: saved.name });
    res.json(saved);
  });

  router.delete('/institutions/:id', async (req: AppRequest, res) => {
    const id = routeParam(req.params.id);
    await institutions.delete(id);
    logger.system.info(`"${req.user!.username}" deleted institution ${id}`);
    await audit(req, 'institution.delete', id);
    res.status(204).end();
  });

  // Built-in skills for the institution toggles. Canvas is every institution's, so only Outlook and Degree Works gate a skill.
  router.get('/skills', (_req, res) =>
    res.json(
      builtinSkills.all.map(({ slug, name, description, requires }) => ({
        slug,
        name,
        description,
        ...(requires && requires !== 'canvas' && { requires }),
      })),
    ),
  );

  // ------------------------------------------------------------ email

  const smtpView = () => {
    const c = mail.config();
    return {
      host: c.host,
      port: c.port,
      secure: c.secure,
      user: c.user,
      password_set: settings.hasSecret(K.smtpPassword),
      from_name: c.fromName,
      from_email: c.fromEmail,
    };
  };

  router.get('/smtp', (_req, res) => res.json(smtpView()));

  router.put('/smtp', async (req: AppRequest, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const fromEmail = text(body.from_email ?? '');
    await settings.setMany({
      [K.smtpHost]: text(body.host ?? ''),
      [K.smtpPort]: numberIn(body.port ?? 587, 1, 65535),
      [K.smtpSecure]: bool(body.secure ?? false),
      [K.smtpUser]: text(body.user ?? ''),
      [K.smtpFromName]: text(body.from_name ?? '', 80),
      [K.smtpFromEmail]: fromEmail ? normalizeEmail(fromEmail) : '',
    });
    // Write-only: absent or undefined keeps the stored password, an empty string clears it.
    if (typeof body.password === 'string') await settings.setSecret(K.smtpPassword, body.password);
    logger.system.info(`"${req.user!.username}" updated the SMTP settings`);
    await audit(req, 'settings.smtp', null);
    res.json(smtpView());
  });

  router.post('/smtp/test', async (req: AppRequest, res) => {
    const to = normalizeEmail((req.body as { to?: unknown })?.to);
    await mail.sendTest(to, req.lang ?? config.LANGUAGE);
    logger.system.info(`"${req.user!.username}" sent a test email to <${to}>`);
    res.status(204).end();
  });

  // ------------------------------------------------------------ web search

  // SearXNG and DuckDuckGo are always on; a paid API joins after them only with a key.
  const webSearchView = () => ({
    paid_provider: settings.getString(K.webSearchPaidProvider, 'none'),
    api_key_set: settings.hasSecret(K.webSearchApiKey),
    searxng: Boolean(config.SEARXNG_URL),
  });

  router.get('/web-search', (_req, res) => res.json(webSearchView()));

  router.put('/web-search', async (req: AppRequest, res) => {
    const body = (req.body ?? {}) as { paid_provider?: unknown; api_key?: unknown };
    const provider = body.paid_provider ?? 'none';
    if (provider !== 'none' && !PAID_SEARCH_PROVIDERS.includes(provider as never)) throw badRequest('error.invalidInput');
    if (body.api_key !== undefined && (typeof body.api_key !== 'string' || body.api_key.length > 300 || /\s/.test(body.api_key))) throw badRequest('error.invalidInput');
    await settings.set(K.webSearchPaidProvider, provider);
    // Write-only, like the SMTP password: absent keeps it, an empty string clears it.
    if (typeof body.api_key === 'string') await settings.setSecret(K.webSearchApiKey, body.api_key);
    logger.system.info(`"${req.user!.username}" updated the web search settings (paid: ${String(provider)})`);
    await audit(req, 'settings.web_search', null);
    res.json(webSearchView());
  });

  /** Runs one search with the paid API as saved, so the admin sees the key works before students rely on it. */
  router.post('/web-search/test', async (_req: AppRequest, res) => {
    const search = paidSearch(settings.getString(K.webSearchPaidProvider, 'none'), settings.getSecret(K.webSearchApiKey));
    if (!search) throw badRequest('error.invalidInput');
    try {
      const hits = await search.search('Florida Gulf Coast University', { limit: 3, signal: AbortSignal.timeout(30_000) });
      res.json({ ok: hits.length > 0, results: hits.length, sample: hits[0]?.url ?? null });
    } catch (err) {
      res.json({ ok: false, error: (err as Error).message.slice(0, 200) });
    }
  });

  // ------------------------------------------------------------ general settings

  const generalView = () => ({
    registration_enabled: settings.getBoolean(K.registrationEnabled, true),
    default_language: settings.getString(K.defaultLanguage, config.LANGUAGE),
    default_theme_mode: settings.getString(K.defaultThemeMode, 'system'),
    default_theme_skin: settings.getString(K.defaultThemeSkin, 'hawk'),
    studyhawk_daily_messages: settings.getNumber(K.studyhawkDailyMessages, 50),
    session_ttl_hours: settings.getNumber(K.sessionTtlHours, config.SESSION_TTL_HOURS),
    mcp_enabled: settings.getBoolean(K.mcpEnabled, false),
    codex_enabled: settings.getBoolean(K.codexEnabled, true),
    // A pause that already ended reads as healthy.
    codex_disabled_until: activePause(settings.getJson<string | null>(K.codexDisabledUntil, null)),
  });

  router.get('/settings', (_req, res) => res.json(generalView()));

  router.patch('/settings', async (req: AppRequest, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const updates: Record<string, unknown> = {};
    if (body.registration_enabled !== undefined) updates[K.registrationEnabled] = bool(body.registration_enabled);
    if (body.default_language !== undefined) {
      if (typeof body.default_language !== 'string' || !isLanguage(body.default_language)) throw badRequest('adminSettings.invalidValue');
      updates[K.defaultLanguage] = body.default_language;
    }
    if (body.default_theme_mode !== undefined) {
      if (!THEME_MODES.includes(body.default_theme_mode as never)) throw badRequest('adminSettings.invalidValue');
      updates[K.defaultThemeMode] = body.default_theme_mode;
    }
    if (body.default_theme_skin !== undefined) {
      if (!THEME_SKINS.includes(body.default_theme_skin as never)) throw badRequest('adminSettings.invalidValue');
      updates[K.defaultThemeSkin] = body.default_theme_skin;
    }
    if (body.studyhawk_daily_messages !== undefined) updates[K.studyhawkDailyMessages] = numberIn(body.studyhawk_daily_messages, 0, 100_000);
    if (body.session_ttl_hours !== undefined) updates[K.sessionTtlHours] = numberIn(body.session_ttl_hours, 1, 24 * 90);
    if (body.mcp_enabled !== undefined) updates[K.mcpEnabled] = bool(body.mcp_enabled);
    if (body.codex_enabled !== undefined) updates[K.codexEnabled] = bool(body.codex_enabled);
    // Only clearing is allowed by hand ("turn back on now"); the breaker sets it.
    if (body.codex_disabled_until === null) updates[K.codexDisabledUntil] = null;

    await settings.setMany(updates);
    logger.system.info(`"${req.user!.username}" updated settings: ${Object.keys(updates).join(', ')}`);
    await audit(req, 'settings.general', null, { keys: Object.keys(updates) });
    res.json(generalView());
  });

  return router;
}
