import type { SettingsService } from '../../db/settings.js';
import { badRequest } from '../../errors.js';
import { SETTINGS_KEYS as K } from '../admin/settings-keys.js';
import { isDiscordWebhookUrl } from '../contact/contact.service.js';

export const REPORT_LIMITS = { messageMin: 10, message: 3000, page: 300, screenshotBytes: 8 * 1024 * 1024 } as const;
const DISCORD_TIMEOUT_MS = 20_000;

/** The image types a screenshot may be, told by their first bytes rather than by what the browser claims. */
const IMAGE_TYPES: { mime: string; ext: string; test: (b: Buffer) => boolean }[] = [
  { mime: 'image/png', ext: 'png', test: (b) => b.length > 8 && b.readUInt32BE(0) === 0x89504e47 },
  { mime: 'image/jpeg', ext: 'jpg', test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/gif', ext: 'gif', test: (b) => b.length > 6 && b.subarray(0, 4).toString('latin1') === 'GIF8' },
  { mime: 'image/webp', ext: 'webp', test: (b) => b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
];

export function sniffImage(bytes: Buffer): { mime: string; ext: string } | null {
  const hit = IMAGE_TYPES.find((type) => type.test(bytes));
  return hit ? { mime: hit.mime, ext: hit.ext } : null;
}

/** Same rules as the contact form: no control characters or bidi overrides, line breaks kept. */
const CONTROL_KEEP_LINES = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f‪-‮⁦-⁩]/g;
const CONTROL = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g;

export function cleanMessage(value: unknown): string {
  if (typeof value !== 'string') throw badRequest('betaReport.invalidMessage');
  const text = value.replace(/\r\n?/g, '\n').replace(CONTROL_KEEP_LINES, '').trim();
  if (text.length < REPORT_LIMITS.messageMin || text.length > REPORT_LIMITS.message) throw badRequest('betaReport.invalidMessage');
  return text;
}

/** Where in the app the tester was: a path only, never a full URL from the client. */
export function cleanPage(value: unknown): string {
  if (typeof value !== 'string') return '';
  const path = value.replace(CONTROL, '').trim().slice(0, REPORT_LIMITS.page);
  return path.startsWith('/') ? path : '';
}

export interface BetaReport {
  message: string;
  page: string;
  userAgent: string;
  reporter: { id: string; username: string; email: string; displayName: string };
  screenshot?: { bytes: Buffer; mime: string; ext: string };
}

const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

/** One embed (Discord's limits: title 256, description 4096, field 1024); mentions in the tester's text never ping anyone. */
export function reportPayload(report: BetaReport, options: { test?: boolean } = {}) {
  const { reporter } = report;
  const fields = [
    { name: 'Tester', value: clip(`${reporter.displayName || reporter.username} (@${reporter.username})`, 1024), inline: true },
    { name: 'Email', value: clip(reporter.email, 1024), inline: true },
    { name: 'User ID', value: reporter.id, inline: false },
  ];
  if (report.page) fields.push({ name: 'Page', value: clip(report.page, 1024), inline: true });
  if (report.userAgent) fields.push({ name: 'Browser', value: clip(report.userAgent, 1024), inline: false });
  return {
    username: 'StudyHawk Beta',
    content: options.test ? 'Test from Admin -> General. If you can read it, beta bug reports reach this channel.' : '',
    allowed_mentions: { parse: [] as string[] },
    embeds: [
      {
        title: options.test ? 'Beta bug report (test)' : 'Beta bug report',
        description: clip(report.message, 4096),
        color: 0xf59e0b,
        fields,
        ...(report.screenshot && { image: { url: `attachment://screenshot.${report.screenshot.ext}` } }),
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

/** Beta testers' bug reports, posted to a Discord channel of their own. Nothing is stored. */
export class BetaReportService {
  constructor(
    private settings: SettingsService,
    private discordTestBase?: string,
  ) {}

  /** The button shows only while the beta test is on and a channel is set. */
  enabled(): boolean {
    return this.settings.getBoolean(K.betaTest, false) && this.settings.hasSecret(K.betaReportWebhook);
  }

  isValidWebhook(value: string): boolean {
    return isDiscordWebhookUrl(value, this.discordTestBase);
  }

  /** Posts one report; the error is short and never holds the webhook URL. */
  async send(report: BetaReport, options: { test?: boolean } = {}): Promise<{ ok: true } | { ok: false; error: string }> {
    const url = this.settings.getSecret(K.betaReportWebhook);
    if (!url) return { ok: false, error: 'no webhook' };
    // Checked again on every send, in case the stored value predates the rule.
    if (!this.isValidWebhook(url)) return { ok: false, error: 'invalid webhook URL' };
    const payload = JSON.stringify(reportPayload(report, options));
    let body: FormData | string = payload;
    const headers: Record<string, string> = {};
    if (report.screenshot) {
      body = new FormData();
      body.append('payload_json', payload);
      body.append('files[0]', new Blob([new Uint8Array(report.screenshot.bytes)], { type: report.screenshot.mime }), `screenshot.${report.screenshot.ext}`);
    } else {
      headers['content-type'] = 'application/json';
    }
    try {
      const res = await fetch(url, { method: 'POST', headers, body, redirect: 'error', signal: AbortSignal.timeout(DISCORD_TIMEOUT_MS) });
      await res.body?.cancel();
      return res.ok ? { ok: true } : { ok: false, error: `HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, error: (err as Error).name === 'TimeoutError' ? 'timeout' : 'network error' };
    }
  }
}
