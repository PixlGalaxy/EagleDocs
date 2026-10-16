import { Router } from 'express';
import type { Db } from '../../db/pool.js';
import type { SettingsService } from '../../db/settings.js';
import { badRequest, unavailable } from '../../errors.js';
import { logger } from '../../logger.js';
import { createRateLimiter, ipBucket } from '../../middleware/rate-limit.js';
import type { AppRequest } from '../../types/index.js';
import { requireAdmin } from '../auth/session.middleware.js';
import { SETTINGS_KEYS as K } from '../admin/settings-keys.js';
import type { MailService } from '../mail/mail.service.js';
import { normalizeEmail } from '../users/users.service.js';
import { CONTACT_LIMITS, parseContactInput, type ContactService } from './contact.service.js';

/** The public Contact page (anyone, signed in or not) and Admin -> Email -> Contact form. */
export function createContactRoutes(deps: { db: Db; contact: ContactService; settings: SettingsService; mail: MailService }) {
  const { db, contact, settings, mail } = deps;
  const open = Router();
  const admin = Router();
  admin.use(requireAdmin);

  const ipLimiter = createRateLimiter(db, {
    windowMs: 60 * 60_000,
    max: 5,
    keyFn: (req) => `contact:ip:${ipBucket(req.ip)}`,
    describe: (req) => `contact form messages from ${req.ip}`,
  });
  // Many IPs writing as one address (or one address flooded with replies) are capped too.
  const emailLimiter = createRateLimiter(db, {
    windowMs: 60 * 60_000,
    max: 3,
    keyFn: (req) => {
      const email = (req.body as { email?: unknown })?.email;
      return typeof email === 'string' && email.trim() && email.length <= CONTACT_LIMITS.email ? `contact:email:${email.trim().toLowerCase()}` : null;
    },
    describe: (req) => `contact form messages as "${String((req.body as { email?: unknown }).email)}"`,
  });

  open.post('/', ipLimiter, emailLimiter, async (req: AppRequest, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    // Honeypot: hidden from people, so whoever fills it is a bot. It is told the message went.
    if (typeof body.website === 'string' && body.website.trim() !== '') {
      logger.warn(`Contact form honeypot filled from ${req.ip}; nothing sent`);
      return res.status(204).end();
    }
    const input = parseContactInput(body);
    const result = await contact.deliver(input);
    if (result.email.status === 'off' && result.discord.status === 'off') throw unavailable('contact.unavailable');
    if (result.email.status !== 'sent' && result.discord.status !== 'sent') throw unavailable('contact.sendFailed');
    logger.info(`Contact form message from <${input.email}> (email: ${result.email.status}, discord: ${result.discord.status})`);
    return res.status(204).end();
  });

  const view = () => ({
    email_to: contact.destination(),
    discord_webhook_set: settings.hasSecret(K.contactDiscordWebhook),
    smtp_configured: mail.isConfigured(),
  });

  admin.get('/contact', (_req, res) => res.json(view()));

  admin.put('/contact', async (req: AppRequest, res) => {
    const body = (req.body ?? {}) as { email_to?: unknown; discord_webhook_url?: unknown };
    if (body.email_to !== undefined) {
      if (typeof body.email_to !== 'string') throw badRequest('users.invalidEmail');
      // Empty goes back to the default inbox.
      await settings.set(K.contactEmailTo, body.email_to.trim() ? normalizeEmail(body.email_to) : '');
    }
    // Write-only, like the SMTP password: absent keeps it, an empty string clears it.
    if (body.discord_webhook_url !== undefined) {
      if (typeof body.discord_webhook_url !== 'string') throw badRequest('contact.invalidWebhook');
      const url = body.discord_webhook_url.trim();
      if (url && !contact.isValidWebhook(url)) throw badRequest('contact.invalidWebhook');
      await settings.setSecret(K.contactDiscordWebhook, url);
    }
    logger.system.info(`"${req.user!.username}" updated the contact form settings`);
    await db
      .query('INSERT INTO audit_log (actor_id, action, target, meta) VALUES ($1, $2, $3, $4)', [req.user!.id, 'settings.contact', null, {}])
      .catch((err: Error) => logger.warn(`Audit log write failed: ${err.message}`));
    res.json(view());
  });

  /** Sends a sample through both channels as saved and reports each one. */
  admin.post('/contact/test', async (req: AppRequest, res) => {
    const result = await contact.deliver(
      { name: req.user!.display_name || req.user!.username, email: req.user!.email, message: 'StudyHawk contact form test.' },
      { test: true, lang: req.lang },
    );
    logger.system.info(`"${req.user!.username}" tested the contact form (email: ${result.email.status}, discord: ${result.discord.status})`);
    res.json(result);
  });

  return { open, admin };
}
