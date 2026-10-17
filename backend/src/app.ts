import { isIP } from 'net';
import express from 'express';
import cookieParser from 'cookie-parser';
import type { EnvConfig } from './config/env.js';
import type { Db } from './db/pool.js';
import type { SettingsService } from './db/settings.js';
import type { Translate } from './i18n/index.js';
import { createCsrfProtection } from './middleware/csrf.js';
import { createErrorHandler, createNotFoundHandler } from './middleware/error-handler.js';
import { requestLogger } from './middleware/request-logger.js';
import { createAdminRoutes } from './modules/admin/admin.routes.js';
import { SETTINGS_KEYS as K } from './modules/admin/settings-keys.js';
import { UsersAdminService } from './modules/admin/users-admin.service.js';
import type { AccountDeletion } from './modules/users/account-deletion.js';
import { createAuthRoutes } from './modules/auth/auth.routes.js';
import type { AuthService } from './modules/auth/auth.service.js';
import type { RegisterService } from './modules/auth/register.service.js';
import { createSessionMiddleware } from './modules/auth/session.middleware.js';
import { createAvatarsRoutes } from './modules/avatars/avatars.routes.js';
import { createLiveRoutes } from './modules/live/live.routes.js';
import { createLogsRoutes } from './modules/logs/logs.routes.js';
import { createContactRoutes } from './modules/contact/contact.routes.js';
import { ContactService } from './modules/contact/contact.service.js';
import { createBetaReportRoutes } from './modules/beta-report/beta-report.routes.js';
import { BetaReportService } from './modules/beta-report/beta-report.service.js';
import type { CourseSpaces } from './modules/canvas/course-spaces.js';
import type { InstitutionsService } from './modules/institutions/institutions.service.js';
import type { MailService } from './modules/mail/mail.service.js';
import type { Bus } from './bus/bus.js';
import type { Secrets } from './crypto/secrets.js';
import { createAgentDataRoutes } from './modules/agent-data/agent-data.routes.js';
import { createChatRoutes } from './modules/chat/chat.routes.js';
import type { ChatService } from './modules/chat/chat.service.js';
import type { ConnectionsService } from './modules/connections/connections.service.js';
import type { ModelCatalog } from './modules/models/catalog.js';
import { createAdminModelRoutes, createModelRoutes } from './modules/models/models.routes.js';
import { createCanvasRoutes } from './modules/canvas/canvas.routes.js';
import type { CanvasService } from './modules/canvas/canvas.service.js';
import { createFilesRoutes } from './modules/files/files.routes.js';
import type { DiskWorkspace } from './engine/workspace.js';
import type { AdminEmbeddings } from './engine/documents.js';
import type { SandboxManager } from './modules/sandbox/manager.js';
import { createBrowserProfiles, createBrowserRoutes, createSandboxAdminRoutes } from './modules/sandbox/sandbox.routes.js';
import type { SandboxTools } from './engine/sandbox.js';
import type { SchoolService } from './modules/school/school.service.js';
import type { AppRequest } from './types/index.js';
import { createPushRoutes, latestBroadcast } from './modules/push/push.routes.js';
import type { PushService } from './modules/push/push.service.js';
import { DailySummaryService } from './modules/push/daily-summary.js';
import type { BuiltinSkills } from './modules/skills/builtin.js';
import { createBillingRoutes } from './modules/billing/billing.routes.js';
import { createUsageRoutes } from './modules/usage/usage.routes.js';
import { createExportRoutes } from './modules/export/export.routes.js';
import { StatusPage } from './modules/status/status-page.js';
import type { BillingService } from './modules/billing/billing.service.js';
import type { TiersService } from './modules/billing/tiers.service.js';
import { createMcpRoutes } from './modules/mcp/mcp.routes.js';
import type { McpServer } from './modules/mcp/mcp.server.js';
import type { OAuthService } from './modules/mcp/oauth.service.js';

export interface AppDeps {
  db: Db;
  config: EnvConfig;
  t: Translate;
  settings: SettingsService;
  auth: AuthService;
  register: RegisterService;
  mail: MailService;
  institutions: InstitutionsService;
  sessionTtlHours: () => number;
  bus: Bus;
  secrets: Secrets;
  chats: ChatService;
  catalog: ModelCatalog;
  connections: ConnectionsService;
  canvas: CanvasService;
  workspace: DiskWorkspace;
  embeddings: AdminEmbeddings;
  sandboxes: SandboxManager;
  sandbox: SandboxTools | undefined;
  school: SchoolService;
  push: PushService;
  builtinSkills: BuiltinSkills;
  courseSpaces: CourseSpaces;
  tiers: TiersService;
  billing: BillingService;
  oauth: OAuthService;
  mcp: McpServer;
  deletion: AccountDeletion;
}

export function createApp(deps: AppDeps): express.Application {
  const { db, config, t, settings, auth, register, mail, institutions, sessionTtlHours, bus, secrets, chats, catalog, connections, canvas, workspace, sandboxes, sandbox, school, push, builtinSkills, courseSpaces, tiers, billing, oauth, mcp, deletion } = deps;
  const app = express();

  // The bundled nginx (loopback) plus any outer proxies from TRUST_PROXY, so
  // req.ip is the visitor's address rather than the proxy's.
  app.set('trust proxy', config.TRUST_PROXY);
  // Behind Cloudflare the edge sets CF-Connecting-IP itself and overwrites what the visitor sent, so it is
  // the visitor's address even when a proxy in between (Nginx Proxy Manager) trusts a spoofable X-Real-IP.
  // Only for requests that came through a trusted proxy: a direct hit keeps its socket address.
  if (config.CLIENT_IP_HEADER) {
    const header = config.CLIENT_IP_HEADER;
    const trusted = app.get('trust proxy fn') as (addr: string, i: number) => boolean;
    app.use((req, _res, next) => {
      const value = req.get(header)?.trim();
      if (value && isIP(value) && trusted(req.socket.remoteAddress ?? '', 0)) Object.defineProperty(req, 'ip', { value, configurable: true });
      next();
    });
  }
  app.disable('x-powered-by');
  app.use(requestLogger);
  // Stripe webhooks: raw body for the signature, and no CSRF token (Stripe cannot send one).
  const billingRoutes = createBillingRoutes({ billing, tiers, settings });
  app.use('/api/billing/webhook', billingRoutes.webhook);
  app.use(express.json({ limit: '1mb' }));
  // OAuth and MCP for ChatGPT, Claude and other clients: tokens instead of cookies, so before the session and CSRF.
  const mcpRoutes = createMcpRoutes({ db, oauth, server: mcp, settings });
  app.use(mcpRoutes.open);
  app.use(cookieParser());
  app.use(createSessionMiddleware(auth, config.COOKIE_SECURE));
  app.use(createCsrfProtection({ secure: config.COOKIE_SECURE }));
  // API answers hold private data: never cached unless a route says otherwise (avatars, files, displays).
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  // Checks the database too: a replica that cannot reach Postgres is not healthy.
  app.get('/api/health', async (_req, res) => {
    try {
      await db.query('SELECT 1');
      res.json({ status: 'ok', node: config.NODE_ID });
    } catch {
      res.status(503).json({ status: 'db_unreachable', node: config.NODE_ID });
    }
  });

  // The public status page's overall state for the site's navbar (Admin -> General sets the page).
  const statusPage = new StatusPage(settings);
  app.get('/api/status', async (_req, res) => {
    res.json(await statusPage.status());
  });

  // Runtime settings for the static frontend (frontend/src/api/config.ts), read
  // fresh so an admin panel edit shows on the next request without a rebuild.
  // DISCORD_WEBHOOK_TEST_BASE (a local fake for the e2e) never applies in production.
  const discordTestBase = config.NODE_ENV === 'production' ? undefined : process.env.DISCORD_WEBHOOK_TEST_BASE || undefined;
  const betaReports = new BetaReportService(settings, discordTestBase);

  app.get('/api/config', async (req: AppRequest, res) => {
    res.json({
      language: settings.getString(K.defaultLanguage, config.LANGUAGE),
      defaultThemeMode: settings.getString(K.defaultThemeMode, 'system'),
      defaultThemeSkin: settings.getString(K.defaultThemeSkin, 'hawk'),
      registrationEnabled: settings.getBoolean(K.registrationEnabled, true),
      emailConfigured: mail.isConfigured(),
      betaTest: settings.getBoolean(K.betaTest, false),
      betaReport: betaReports.enabled(),
      institutions: await institutions.listPublic(),
      billingEnabled: billing.enabled(),
      codexEnabled: catalog.codexAvailable(),
      mcpEnabled: settings.getBoolean(K.mcpEnabled, false),
      vapidPublicKey: push.publicKey(),
      broadcast: await latestBroadcast(db, req.user?.institution_id ?? null),
      statusPageUrl: statusPage.url(),
    });
  });

  app.use('/api/auth', createAuthRoutes(db, config, auth, register, sessionTtlHours, deletion));
  app.use('/api/avatars', createAvatarsRoutes(db, config.AVATARS_DIR));
  const { chatsRouter, jobsRouter, approvalsRouter } = createChatRoutes(db, bus, chats, workspace, catalog);
  app.use('/api/chats', chatsRouter);
  app.use('/api/jobs', jobsRouter);
  app.use('/api/approvals', approvalsRouter);
  const browserProfiles = createBrowserProfiles({ db, bus, config, sandboxes, tools: sandbox });
  const { models, conns } = createModelRoutes(db, catalog, connections, school, browserProfiles);
  const { canvasRouter, connectionRouter } = createCanvasRoutes(canvas, connections, courseSpaces);
  app.use('/api/models', models);
  app.use('/api/canvas', canvasRouter);
  const { files, rags } = createFilesRoutes(workspace, chats);
  app.use('/api/files', files);
  app.use('/api/rags', rags);
  // Canvas/SSO/Degree Works cards first, then the generic connection routes.
  app.use('/api/connections', connectionRouter);
  app.use('/api/connections', conns);
  const agentData = createAgentDataRoutes(db, builtinSkills, tiers);
  app.use('/api/memories', agentData.memories);
  app.use('/api/schedules', agentData.schedules);
  app.use('/api/skills', agentData.skills);
  app.use('/api/browser', createBrowserRoutes({ db, sandboxes, profiles: browserProfiles }));

  const pushRoutes = createPushRoutes({ db, push, settings, t, dailySummary: new DailySummaryService(db, canvas, push, t) });
  app.use('/api/push', pushRoutes.user);
  app.use('/api/oauth', mcpRoutes.consent);
  app.use('/api/mcp-apps', mcpRoutes.apps);
  app.use('/api/billing', billingRoutes.user);
  app.use('/api/usage', createUsageRoutes({ db, tiers, sandboxes, workspace }));
  app.use('/api/account/export', createExportRoutes({ db, workspace }));
  // Open tabs follow admin changes; `announce` comes before every /api/admin router.
  const live = createLiveRoutes(bus);
  app.use('/api/live', live.router);
  app.use('/api/admin', live.announce);
  app.use('/api/admin', billingRoutes.admin);
  // The public Contact page: email plus Discord.
  const contactRoutes = createContactRoutes({
    db,
    settings,
    mail,
    contact: new ContactService(settings, mail, t, discordTestBase),
  });
  app.use('/api/contact', contactRoutes.open);
  app.use('/api/admin', contactRoutes.admin);
  // The BetaTest Bug Report button: only while the beta test is on and its channel is set.
  const betaReportRoutes = createBetaReportRoutes({ db, settings, reports: betaReports });
  app.use('/api/beta-report', betaReportRoutes.user);
  app.use('/api/admin', betaReportRoutes.admin);
  app.use('/api/admin', pushRoutes.admin);
  app.use('/api/admin/logs', createLogsRoutes(db));
  app.use('/api/admin/models', createAdminModelRoutes(db, secrets));
  app.use('/api/admin', createSandboxAdminRoutes({ db, bus, config, settings, sandboxes, workspace }));
  app.use(
    '/api/admin',
    createAdminRoutes({ db, config, settings, mail, institutions, users: new UsersAdminService(db, institutions, deletion), t, builtinSkills, onUserChanged: (id) => tiers.forget(id) }),
  );

  app.use(createNotFoundHandler(t));
  app.use(createErrorHandler(t));
  return app;
}
