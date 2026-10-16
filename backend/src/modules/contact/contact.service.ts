import type { SettingsService } from '../../db/settings.js';
import { AppError, badRequest } from '../../errors.js';
import { format, type Translate } from '../../i18n/index.js';
import { logger } from '../../logger.js';
import { SETTINGS_KEYS as K } from '../admin/settings-keys.js';
import type { MailService } from '../mail/mail.service.js';
import { EMAIL, MAX_EMAIL_LENGTH } from '../users/users.service.js';

export const DEFAULT_CONTACT_EMAIL = 'support@studyhawk.app';
export const CONTACT_LIMITS = { name: 100, email: MAX_EMAIL_LENGTH, messageMin: 10, message: 5000 } as const;
const DISCORD_TIMEOUT_MS = 10_000;

export interface ContactInput {
  name: string;
  email: string;
  message: string;
}

/** C0/C1 controls, DEL, and the bidi overrides that can flip how a name reads. */
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;
const HAS_CONTROL = new RegExp(CONTROL.source);
/** The same, but a message keeps its line breaks and tabs. */
const CONTROL_KEEP_LINES = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;

/** Trims and checks the public form's fields; throws a 400 the page shows as is. */
export function parseContactInput(body: Record<string, unknown>): ContactInput {
  const { name, email, message } = body;
  if (typeof name !== 'string' || typeof email !== 'string' || typeof message !== 'string') throw badRequest('error.invalidInput');

  const cleanName = name.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
  if (!cleanName || cleanName.length > CONTACT_LIMITS.name) throw badRequest('contact.invalidName');

  // An address with control characters is refused rather than repaired: it goes into a Reply-To header.
  const cleanEmail = email.trim();
  if (cleanEmail.length > CONTACT_LIMITS.email || HAS_CONTROL.test(cleanEmail) || !EMAIL.test(cleanEmail)) throw badRequest('users.invalidEmail');

  const cleanMessage = message.replace(/\r\n?/g, '\n').replace(CONTROL_KEEP_LINES, '').trim();
  if (cleanMessage.length < CONTACT_LIMITS.messageMin || cleanMessage.length > CONTACT_LIMITS.message) throw badRequest('contact.invalidMessage');

  return { name: cleanName, email: cleanEmail.toLowerCase(), message: cleanMessage };
}

const DISCORD_HOSTS = new Set(['discord.com', 'discordapp.com', 'ptb.discord.com', 'ptb.discordapp.com', 'canary.discord.com', 'canary.discordapp.com']);
const WEBHOOK_PATH = /^\/api\/(?:v\d{1,2}\/)?webhooks\/\d{1,25}\/[\w-]{1,200}\/?$/;

/**
 * Only Discord's own webhook URLs, so the setting can never aim the backend at
 * an internal address. `testBase` (an `http://localhost:<port>` fake, outside
 * production only) is the e2e's way in; it never widens the Discord check.
 */
export function isDiscordWebhookUrl(value: string, testBase?: string): boolean {
  if (value.length > 500) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username || url.password || url.search || url.hash || !WEBHOOK_PATH.test(url.pathname)) return false;
  if (url.protocol === 'https:' && url.port === '' && DISCORD_HOSTS.has(url.hostname)) return true;
  if (!testBase || !URL.canParse(testBase)) return false;
  const base = new URL(testBase);
  return base.protocol === 'http:' && url.origin === base.origin && /^(localhost|127\.0\.0\.1)$/.test(base.hostname);
}

const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

/**
 * One embed in Discord's limits (title 256, description 4096, field 1024, 6000
 * in all). `allowed_mentions` with no parse types means nothing in the user's
 * text can ping @everyone, @here, a role or a user.
 */
export function discordPayload(input: ContactInput, labels: { title: string; name: string; email: string; test?: string }) {
  return {
    username: 'StudyHawk',
    content: labels.test ? clip(labels.test, 200) : '',
    allowed_mentions: { parse: [] as string[] },
    embeds: [
      {
        title: clip(labels.title, 256),
        description: clip(input.message, 4096),
        color: 0x0f62fe,
        fields: [
          { name: clip(labels.name, 256), value: clip(input.name, 1024), inline: true },
          { name: clip(labels.email, 256), value: clip(input.email, 1024), inline: true },
        ],
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

export type ChannelStatus = 'sent' | 'failed' | 'off';
export interface ChannelResult {
  status: ChannelStatus;
  /** Short and safe for the admin: never the webhook URL or the message. */
  error?: string;
}
export interface DeliveryResult {
  email: ChannelResult;
  discord: ChannelResult;
}

/** Contact form delivery: an email to the support inbox and a post to a Discord channel. Nothing is stored. */
export class ContactService {
  constructor(
    private settings: SettingsService,
    private mail: MailService,
    private t: Translate,
    private discordTestBase?: string,
  ) {}

  destination(): string {
    return this.settings.getString(K.contactEmailTo, '') || DEFAULT_CONTACT_EMAIL;
  }

  isValidWebhook(value: string): boolean {
    return isDiscordWebhookUrl(value, this.discordTestBase);
  }

  /** Both channels at once; each reports on its own. */
  async deliver(input: ContactInput, options: { test?: boolean; lang?: string } = {}): Promise<DeliveryResult> {
    const [email, discord] = await Promise.all([this.sendEmail(input, options), this.sendDiscord(input, options)]);
    if (email.status === 'failed') logger.warn(`Contact form email to <${this.destination()}> failed: ${email.error ?? ''}`);
    if (discord.status === 'failed') logger.warn(`Contact form Discord post failed: ${discord.error ?? ''}`);
    return { email, discord };
  }

  private async sendEmail(input: ContactInput, options: { test?: boolean; lang?: string }): Promise<ChannelResult> {
    if (!this.mail.isConfigured()) return { status: 'off' };
    try {
      await this.mail.sendContact(this.destination(), input, options);
      return { status: 'sent' };
    } catch (err) {
      return { status: 'failed', error: err instanceof AppError ? this.t(err.key, options.lang) : 'error' };
    }
  }

  private async sendDiscord(input: ContactInput, options: { test?: boolean; lang?: string }): Promise<ChannelResult> {
    const url = this.settings.getSecret(K.contactDiscordWebhook);
    if (!url) return { status: 'off' };
    // Checked again on every send, in case the stored value predates the rule.
    if (!this.isValidWebhook(url)) return { status: 'failed', error: 'invalid webhook URL' };
    const t = (key: Parameters<Translate>[0]) => this.t(key, options.lang);
    const body = discordPayload(input, {
      title: format(t('mail.contactSubject'), { name: input.name }),
      name: t('contact.name'),
      email: 'Email',
      test: options.test ? t('contact.testMessage') : undefined,
    });
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.timeout(DISCORD_TIMEOUT_MS),
      });
      await res.body?.cancel();
      return res.ok ? { status: 'sent' } : { status: 'failed', error: `HTTP ${res.status}` };
    } catch (err) {
      return { status: 'failed', error: (err as Error).name === 'TimeoutError' ? 'timeout' : 'network error' };
    }
  }
}
