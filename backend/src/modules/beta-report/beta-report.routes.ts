import { Router } from 'express';
import busboy from 'busboy';
import type { Db } from '../../db/pool.js';
import type { SettingsService } from '../../db/settings.js';
import { badRequest, notFound, unavailable } from '../../errors.js';
import { logger } from '../../logger.js';
import { createRateLimiter } from '../../middleware/rate-limit.js';
import type { AppRequest } from '../../types/index.js';
import { requireAdmin, requireAuth } from '../auth/session.middleware.js';
import { SETTINGS_KEYS as K } from '../admin/settings-keys.js';
import { cleanMessage, cleanPage, REPORT_LIMITS, sniffImage, type BetaReport, type BetaReportService } from './beta-report.service.js';

interface ParsedForm {
  fields: Record<string, string>;
  screenshot?: Buffer;
}

/** Reads the form into memory: a few short fields and at most one screenshot under the size limit. */
function readForm(req: AppRequest): Promise<ParsedForm> {
  return new Promise((resolve, reject) => {
    let parser: busboy.Busboy;
    try {
      parser = busboy({ headers: req.headers, limits: { files: 1, fields: 5, fieldSize: REPORT_LIMITS.message * 4, fileSize: REPORT_LIMITS.screenshotBytes } });
    } catch {
      return reject(badRequest('error.invalidInput'));
    }
    const fields: Record<string, string> = {};
    const chunks: Buffer[] = [];
    let sawFile = false;
    let failure: unknown = null;
    parser.on('field', (name, value) => {
      fields[name] = value;
    });
    parser.on('file', (_field, stream) => {
      sawFile = true;
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('limit', () => {
        failure ??= badRequest('betaReport.tooLarge');
      });
    });
    parser.on('error', (err) => {
      failure ??= err;
    });
    parser.on('close', () => {
      if (failure) return reject(failure);
      const bytes = Buffer.concat(chunks);
      resolve({ fields, screenshot: sawFile && bytes.length > 0 ? bytes : undefined });
    });
    req.pipe(parser);
  });
}

/** The BetaTest Bug Report button (signed-in testers) and its channel in Admin -> General. */
export function createBetaReportRoutes(deps: { db: Db; settings: SettingsService; reports: BetaReportService }) {
  const { db, settings, reports } = deps;
  const user = Router();
  const admin = Router();
  user.use(requireAuth);
  admin.use(requireAdmin);

  // Serious use only: a few an hour, and a cap for the day.
  const hourly = createRateLimiter(db, {
    windowMs: 60 * 60_000,
    max: 5,
    keyFn: (req) => `beta-report:hour:${(req as AppRequest).user!.id}`,
    describe: (req) => `beta bug reports from "${(req as AppRequest).user!.username}"`,
  });
  const daily = createRateLimiter(db, {
    windowMs: 24 * 60 * 60_000,
    max: 15,
    keyFn: (req) => `beta-report:day:${(req as AppRequest).user!.id}`,
    describe: (req) => `beta bug reports today from "${(req as AppRequest).user!.username}"`,
  });

  // Checked before the limits, so a report while the beta is off does not count.
  const onlyInBeta = (_req: AppRequest, _res: unknown, next: (err?: unknown) => void) => next(reports.enabled() ? undefined : notFound());

  user.post('/', onlyInBeta, hourly, daily, async (req: AppRequest, res) => {
    const form = await readForm(req);
    const message = cleanMessage(form.fields.message);
    let screenshot: BetaReport['screenshot'];
    if (form.screenshot) {
      const type = sniffImage(form.screenshot);
      if (!type) throw badRequest('betaReport.invalidImage');
      screenshot = { bytes: form.screenshot, ...type };
    }
    const u = req.user!;
    const result = await reports.send({
      message,
      page: cleanPage(form.fields.page),
      userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
      reporter: { id: u.id, username: u.username, email: u.email, displayName: u.display_name ?? '' },
      screenshot,
    });
    if (!result.ok) {
      logger.warn(`Beta bug report from "${u.username}" not delivered: ${result.error}`);
      throw unavailable('betaReport.sendFailed');
    }
    logger.info(`Beta bug report from "${u.username}"${screenshot ? ' with a screenshot' : ''}`);
    res.status(204).end();
  });

  const view = () => ({ discord_webhook_set: settings.hasSecret(K.betaReportWebhook) });

  admin.get('/beta-report', (_req, res) => res.json(view()));

  // Write-only, like the contact webhook: an empty string clears it.
  admin.put('/beta-report', async (req: AppRequest, res) => {
    const value = (req.body as { discord_webhook_url?: unknown } | undefined)?.discord_webhook_url;
    if (typeof value !== 'string') throw badRequest('contact.invalidWebhook');
    const url = value.trim();
    if (url && !reports.isValidWebhook(url)) throw badRequest('contact.invalidWebhook');
    await settings.setSecret(K.betaReportWebhook, url);
    logger.system.info(`"${req.user!.username}" ${url ? 'set' : 'cleared'} the beta bug report webhook`);
    await db
      .query('INSERT INTO audit_log (actor_id, action, target, meta) VALUES ($1, $2, $3, $4)', [req.user!.id, 'settings.beta_report', null, {}])
      .catch((err: Error) => logger.warn(`Audit log write failed: ${err.message}`));
    res.json(view());
  });

  admin.post('/beta-report/test', async (req: AppRequest, res) => {
    const u = req.user!;
    const result = await reports.send(
      {
        message: 'StudyHawk beta bug report test.',
        page: '/admin',
        userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
        reporter: { id: u.id, username: u.username, email: u.email, displayName: u.display_name ?? '' },
      },
      { test: true },
    );
    logger.system.info(`"${u.username}" tested the beta bug report webhook (${result.ok ? 'sent' : result.error})`);
    res.json(result);
  });

  return { user, admin };
}
