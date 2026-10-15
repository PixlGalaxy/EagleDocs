import { mkdirSync } from 'fs';
import { loadEnv } from './config/env.js';
import { prepareDevEnvironment } from './dev/dev-env.js';
import { Bus } from './bus/bus.js';
import { Secrets } from './crypto/secrets.js';
import { runMigrations } from './db/migrate.js';
import { createPool, type Db } from './db/pool.js';
import { SettingsService, verifyMasterKey } from './db/settings.js';
import { LOCKS } from './db/tx.js';
import { createTranslator } from './i18n/index.js';
import { scheduleExclusive } from './leader/leader.js';
import { logger } from './logger.js';
import { pruneRateLimits } from './middleware/rate-limit.js';
import { SETTINGS_KEYS } from './modules/admin/settings-keys.js';
import { AuthService } from './modules/auth/auth.service.js';
import { bootstrapAdmin } from './modules/auth/bootstrap.js';
import { seedDevUsers } from './modules/auth/dev-seed.js';
import { startFileTailers } from './modules/logs/file-tailer.js';
import { lastShippedFileLines, pruneLogs, startLogShipper } from './modules/logs/log-shipper.js';
import { RegisterService } from './modules/auth/register.service.js';
import { InstitutionsService } from './modules/institutions/institutions.service.js';
import { MailService } from './modules/mail/mail.service.js';
import { pruneNodes, startHeartbeat } from './nodes/nodes.js';
import { createApp } from './app.js';
import { setupEngine } from './engine/setup.js';
import { SandboxManager } from './modules/sandbox/manager.js';
import { SandboxTools } from './engine/sandbox.js';
import { SchoolService } from './modules/school/school.service.js';
import { PushService } from './modules/push/push.service.js';
import { BuiltinSkills, loadBuiltinSkills } from './modules/skills/builtin.js';
import { CourseFolders, syncDueCourseFolders } from './modules/canvas/course-folders.js';
import { TiersService } from './modules/billing/tiers.service.js';
import { BillingService } from './modules/billing/billing.service.js';
import { OAuthService } from './modules/mcp/oauth.service.js';
import { McpServer } from './modules/mcp/mcp.server.js';
import { DiskWorkspace, sweepTemp } from './engine/workspace.js';
import { AdminEmbeddings } from './engine/documents.js';
import { ChatService } from './modules/chat/chat.service.js';
import { ConnectionsService } from './modules/connections/connections.service.js';
import { pruneJobEvents, reapOrphanJobs, JobWorker } from './modules/jobs/worker.js';
import { runDueSchedules } from './modules/jobs/scheduler.js';
import { ModelCatalog } from './modules/models/catalog.js';
import { CanvasService } from './modules/canvas/canvas.service.js';

/** Postgres may still be starting (or failing over) when the container boots. */
async function waitForDatabase(db: Db, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await db.query('SELECT 1');
      return;
    } catch (err) {
      if (Date.now() > deadline) throw err;
      logger.warn(`Database not reachable yet (${(err as Error).message}), retrying`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

/** Model answers carry emoji and every language: a non-UTF8 database would fail mid-answer. */
async function assertUtf8(db: Db): Promise<void> {
  const { rows } = await db.query<{ server_encoding: string }>('SHOW server_encoding');
  const encoding = rows[0]?.server_encoding;
  if (encoding !== 'UTF8') {
    throw new Error(
      `The database uses ${encoding} encoding; EagleDocs needs UTF8 (CREATE DATABASE ... ENCODING 'UTF8'). ` +
        'In development, delete data/dev-postgres so it is recreated.',
    );
  }
}

async function main() {
  const stopDevDatabase = await prepareDevEnvironment();
  const config = loadEnv();
  mkdirSync(config.ASSETS_DIR, { recursive: true });

  const db = createPool(config);
  const secrets = new Secrets(config.MASTER_KEY);
  const t = createTranslator(config.LOCALES_DIR, config.LANGUAGE);

  await waitForDatabase(db);
  await assertUtf8(db);
  // Every replica runs these; advisory locks make the work happen once.
  await runMigrations(db);
  const flushLogs = startLogShipper(db, config.NODE_ID);
  startFileTailers(await lastShippedFileLines(db, config.NODE_ID));
  await verifyMasterKey(db, secrets);
  await seedDevUsers(db, config);
  await bootstrapAdmin(db, config);

  const bus = new Bus(config, db);
  await bus.start();
  const settings = new SettingsService(db, bus, secrets);
  await settings.start();
  bus.onReconnect = () => void settings.reload();
  await startHeartbeat(db, config);

  const sessionTtlHours = () => settings.getNumber(SETTINGS_KEYS.sessionTtlHours, config.SESSION_TTL_HOURS);
  const auth = new AuthService(db, sessionTtlHours);
  const institutions = new InstitutionsService(db);
  const mail = new MailService(settings, t);
  const register = new RegisterService(db, config, settings, institutions, mail, auth);
  const connections = new ConnectionsService(db, secrets, config.BACKEND_VERSION);
  const catalog = new ModelCatalog(db, settings, secrets, connections, config.BACKEND_VERSION);
  const chats = new ChatService(db);
  const canvas = new CanvasService(db, connections);
  const workspace = new DiskWorkspace(config.DATA_ROOT, settings);
  // Every per-student limit comes from their plan (tiers): disk, sandbox, daily messages, jobs, schedules, helpers.
  const tiers = new TiersService(db);
  const billing = new BillingService(db, settings, tiers, config);
  workspace.setQuotaSource(async (userId) => (await tiers.limitsFor(userId)).diskMb);
  catalog.setDailyLimitSource(async (userId) => (await tiers.limitsFor(userId)).dailyMessages);
  const courseFolders = new CourseFolders(db, canvas, workspace);
  const embeddings = new AdminEmbeddings(db, secrets);
  // Before the engine: code and browser tools are offered only when sandboxes work.
  const sandboxes = new SandboxManager(db, bus, settings, config);
  sandboxes.setPerUserLimits(async (userId) => tiers.limitsFor(userId));
  await sandboxes.start().catch((err) => logger.warn(`Sandboxes are off: ${(err as Error).message}`));
  const sandbox = sandboxes.enabled ? new SandboxTools(sandboxes, workspace) : undefined;
  const push = new PushService(db, settings, config.NODE_ENV !== 'production');
  await push.ensureKeys().catch((err) => logger.warn(`Web push is off: ${(err as Error).message}`));
  // The Settings test of a school account can wait on Duo too: tell the phone.
  const school = new SchoolService(db, connections, sandbox, async (userId, message) => {
    const { rows } = await db.query<{ language: string }>('SELECT language FROM users WHERE id = $1', [userId]);
    await push.notify(userId, { kind: 'mfa_required', title: t('pushMsg.mfaTitle', rows[0]?.language), body: message, url: '/settings?section=connections', tag: `mfa-test-${userId}` });
  });
  const builtinSkills = new BuiltinSkills(db, loadBuiltinSkills());
  logger.info(`Loaded ${builtinSkills.all.length} built-in skills`);
  const engine = await setupEngine(db, bus, { workspace, embeddings, sandbox, searxngUrl: config.SEARXNG_URL, builtinSkills });
  // EagleDocs as an MCP app: the same tools as the web agent, for ChatGPT, Claude and other clients.
  const oauth = new OAuthService(db, config.PUBLIC_URL);
  const mcp = new McpServer({
    db,
    engine,
    builtinSkills,
    tiers,
    version: config.BACKEND_VERSION,
    hostFor: (userId) => ({
      canvas: { service: canvas, userId, workspace, folders: courseFolders },
      school: { service: school, userId, workspace },
    }),
  });
  const worker = new JobWorker({ db, bus, config, engine, chats, catalog, canvas, workspace, embeddings, school, push, builtinSkills, courseFolders, tiers, t, concurrency: config.JOB_WORKERS });
  await worker.start();

  // Leader tasks: whichever replica gets the advisory lock runs each cycle.
  scheduleExclusive(db, 'pending-cleanup', LOCKS.pendingCleanup, 15 * 60 * 1000, () => register.deleteExpiredPending());
  scheduleExclusive(db, 'housekeeping', LOCKS.housekeeping, 60 * 60 * 1000, async () => {
    await auth.pruneExpired();
    await pruneRateLimits(db);
    await pruneNodes(db);
    await pruneLogs(db);
    await pruneJobEvents(db);
    // OAuth: unused requests and expired tokens are never needed again.
    await db.query("DELETE FROM oauth_requests WHERE expires_at < now() - interval '1 day'");
    // Registered but never used (no grant) after a week: registration is open, so do not keep them forever.
    await db.query("DELETE FROM oauth_clients c WHERE c.created_at < now() - interval '7 days' AND NOT EXISTS (SELECT 1 FROM oauth_grants g WHERE g.client_id = c.id)");
    await db.query("DELETE FROM oauth_tokens WHERE expires_at < now() - interval '1 day'");
  });
  scheduleExclusive(db, 'scheduler', LOCKS.scheduler, 60 * 1000, () => runDueSchedules(db, bus));
  scheduleExclusive(db, 'job-reaper', LOCKS.jobReaper, 10 * 1000, () => reapOrphanJobs(db, bus));
  // TEMP files expire 24 h after their last change.
  // "<Term>/<Course>/" folders follow Canvas: assignments, instructions, announcements.
  scheduleExclusive(db, 'canvas-folders', LOCKS.canvasFolders, 15 * 60 * 1000, () => syncDueCourseFolders(db, courseFolders));
  // A failed payment keeps the plan for the grace period, then the student goes back to the default plan.
  scheduleExclusive(db, 'billing-grace', LOCKS.billingGrace, 60 * 60 * 1000, () => billing.expireGrace());
  scheduleExclusive(db, 'temp-sweep', LOCKS.tempSweep, 15 * 60 * 1000, async () => {
    await sweepTemp(config.DATA_ROOT);
  });

  const app = createApp({
    db,
    config,
    t,
    settings,
    auth,
    register,
    mail,
    institutions,
    sessionTtlHours,
    bus,
    secrets,
    chats,
    catalog,
    connections,
    canvas,
    workspace,
    embeddings,
    sandboxes,
    sandbox,
    school,
    push,
    builtinSkills,
    courseFolders,
    tiers,
    billing,
    oauth,
    mcp,
  });
  const onListening = () => {
    logger.info(`Node ${config.NODE_ID} listening on ${config.HOST ?? 'all interfaces'}:${config.PORT} (${config.NODE_ENV})`);
    logger.info(`Shared data root: ${config.DATA_ROOT}`);
    logger.info(
      config.TRUST_PROXY_SETTING
        ? `Trusted proxies: loopback, ${config.TRUST_PROXY_SETTING}`
        : 'Trusted proxies: loopback only (set TRUST_PROXY when running behind another reverse proxy)',
    );
  };
  const server = config.HOST ? app.listen(config.PORT, config.HOST, onListening) : app.listen(config.PORT, onListening);

  const shutdown = (signal: string) => {
    logger.info(`${signal} received, shutting down`);
    server.close();
    worker.stop();
    void sandboxes
      .stopAll()
      .catch(() => undefined)
      .then(() => bus.stop())
      .then(flushLogs)
      .finally(() =>
        db
          .end()
          .then(() => stopDevDatabase?.())
          .finally(() => process.exit(0)),
      );
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error('Fatal error during startup', err);
  process.exit(1);
});
