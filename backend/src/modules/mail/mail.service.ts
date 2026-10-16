import nodemailer from 'nodemailer';
import type { SettingsService } from '../../db/settings.js';
import type { Translate } from '../../i18n/index.js';
import { format } from '../../i18n/index.js';
import { unavailable } from '../../errors.js';
import { logger } from '../../logger.js';
import { SETTINGS_KEYS as K } from '../admin/settings-keys.js';
import { renderContactEmail, renderEmail } from './templates.js';

/** The product name is fixed: StudyHawk is not white-labelled. */
const APP_NAME = 'StudyHawk';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string | undefined;
  fromName: string;
  fromEmail: string;
}

/** Sends through the SMTP server configured in Admin -> Email. */
export class MailService {
  constructor(private settings: SettingsService, private t: Translate) {}

  config(): SmtpConfig {
    const s = this.settings;
    return {
      host: s.getString(K.smtpHost, ''),
      port: s.getNumber(K.smtpPort, 587),
      secure: s.getBoolean(K.smtpSecure, false),
      user: s.getString(K.smtpUser, ''),
      password: s.getSecret(K.smtpPassword),
      fromName: s.getString(K.smtpFromName, APP_NAME),
      fromEmail: s.getString(K.smtpFromEmail, ''),
    };
  }

  /** Sign-up and password reset are refused while this is false. */
  isConfigured(): boolean {
    const c = this.config();
    return Boolean(c.host && c.fromEmail);
  }

  private async send(to: string, subject: string, html: string, text: string, replyTo?: { name: string; address: string }): Promise<void> {
    const c = this.config();
    if (!c.host || !c.fromEmail) throw unavailable('mail.notConfigured');
    const transport = nodemailer.createTransport({
      host: c.host,
      port: c.port,
      secure: c.secure,
      auth: c.user ? { user: c.user, pass: c.password ?? '' } : undefined,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
    });
    try {
      await transport.sendMail({ from: { name: c.fromName, address: c.fromEmail }, to, subject, html, text, ...(replyTo && { replyTo }) });
    } catch (err) {
      logger.error(`Email to ${to} failed`, err);
      throw unavailable('mail.sendFailed');
    } finally {
      transport.close();
    }
  }

  async sendVerification(to: string, lang: string, link: string, code: string, expiresAt: Date): Promise<void> {
    const t = (key: Parameters<Translate>[0]) => this.t(key, lang);
    const app = APP_NAME;
    const email = renderEmail({
      appName: app,
      intro: format(t('mail.verifyIntro'), { app }),
      button: { label: t('mail.verifyButton'), url: link },
      code: { label: t('mail.verifyCode'), value: code },
      footer: [format(t('mail.verifyExpires'), { date: expiresAt.toUTCString() }), t('mail.ignore')],
    });
    await this.send(to, format(t('mail.verifySubject'), { app }), email.html, email.text);
  }

  async sendPasswordReset(to: string, lang: string, link: string): Promise<void> {
    const t = (key: Parameters<Translate>[0]) => this.t(key, lang);
    const app = APP_NAME;
    const email = renderEmail({
      appName: app,
      intro: format(t('mail.resetIntro'), { app }),
      button: { label: t('mail.resetButton'), url: link },
      footer: [t('mail.resetExpires'), t('mail.ignore')],
    });
    await this.send(to, format(t('mail.resetSubject'), { app }), email.html, email.text);
  }

  /** A contact form message for the support inbox; replying answers the sender. */
  async sendContact(to: string, from: { name: string; email: string; message: string }, options: { test?: boolean; lang?: string } = {}): Promise<void> {
    const t = (key: Parameters<Translate>[0]) => this.t(key, options.lang);
    const email = renderContactEmail({
      appName: APP_NAME,
      intro: format(t('mail.contactIntro'), { name: from.name, email: from.email }),
      message: from.message,
      footer: [...(options.test ? [t('contact.testMessage')] : []), t('mail.contactReply')],
    });
    const subject = format(t('mail.contactSubject'), { name: from.name });
    await this.send(to, options.test ? `[test] ${subject}` : subject, email.html, email.text, { name: from.name, address: from.email });
  }

  async sendTest(to: string, lang: string): Promise<void> {
    const app = APP_NAME;
    const email = renderEmail({ appName: app, intro: format(this.t('mail.testBody', lang), { app }), footer: [] });
    await this.send(to, format(this.t('mail.testSubject', lang), { app }), email.html, email.text);
  }
}
