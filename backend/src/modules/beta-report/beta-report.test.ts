import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import type { SettingsService } from '../../db/settings.js';
import { AppError } from '../../errors.js';
import { SETTINGS_KEYS as K } from '../admin/settings-keys.js';
import { BetaReportService, cleanMessage, cleanPage, reportPayload, sniffImage, type BetaReport } from './beta-report.service.js';

const keyOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return err instanceof AppError ? err.key : 'not an AppError';
  }
  return 'no error';
};

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const report: BetaReport = {
  message: 'The plan covers the send button. @everyone look',
  page: '/chat/abc',
  userAgent: 'Mozilla/5.0',
  reporter: { id: 'u-1', username: 'ana', email: 'ana@fgcu.edu', displayName: 'Ana' },
};

/** Settings with only what the service reads. */
const settingsWith = (values: { beta?: boolean; webhook?: string }) =>
  ({
    getBoolean: (key: string, fallback: boolean) => (key === K.betaTest ? (values.beta ?? fallback) : fallback),
    hasSecret: (key: string) => key === K.betaReportWebhook && !!values.webhook,
    getSecret: (key: string) => (key === K.betaReportWebhook ? values.webhook : undefined),
  }) as unknown as SettingsService;

test('screenshots are told by their bytes, not their name', () => {
  assert.equal(sniffImage(PNG)?.mime, 'image/png');
  assert.equal(sniffImage(Buffer.from('ffd8ffe000104a464946', 'hex'))?.ext, 'jpg');
  assert.equal(sniffImage(Buffer.from('GIF89a\u0001\u0000', 'latin1'))?.ext, 'gif');
  assert.equal(sniffImage(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]))?.ext, 'webp');
  assert.equal(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), null);
  assert.equal(sniffImage(Buffer.from('%PDF-1.7 ...')), null);
});

test('the message is cleaned and must be 10 to 3000 characters', () => {
  assert.equal(cleanMessage('\r\n  It broke\u0007 here\r\nsecond line  '), 'It broke here\nsecond line');
  assert.equal(keyOf(() => cleanMessage('short')), 'betaReport.invalidMessage');
  assert.equal(keyOf(() => cleanMessage('x'.repeat(3001))), 'betaReport.invalidMessage');
  assert.equal(keyOf(() => cleanMessage('x'.repeat(3000))), 'no error');
  assert.equal(keyOf(() => cleanMessage(undefined)), 'betaReport.invalidMessage');
});

test('the page is a path only', () => {
  assert.equal(cleanPage('/chat/abc?x=1'), '/chat/abc?x=1');
  assert.equal(cleanPage('https://evil.example/'), '');
  assert.equal(cleanPage(42), '');
  assert.equal(cleanPage(`/${'a'.repeat(400)}`).length, 300);
});

test('the Discord embed never pings anyone and links the screenshot', () => {
  const payload = reportPayload({ ...report, screenshot: { bytes: PNG, mime: 'image/png', ext: 'png' } });
  assert.deepEqual(payload.allowed_mentions, { parse: [] });
  assert.equal(payload.embeds[0]!.image?.url, 'attachment://screenshot.png');
  assert.ok(payload.embeds[0]!.fields.some((f) => f.name === 'Email' && f.value === 'ana@fgcu.edu'));
  assert.equal(reportPayload(report).embeds[0]!.image, undefined);
});

test('the button is on only in a beta with a channel set', () => {
  assert.equal(new BetaReportService(settingsWith({ beta: true, webhook: 'https://discord.com/api/webhooks/1/a' })).enabled(), true);
  assert.equal(new BetaReportService(settingsWith({ beta: false, webhook: 'https://discord.com/api/webhooks/1/a' })).enabled(), false);
  assert.equal(new BetaReportService(settingsWith({ beta: true })).enabled(), false);
});

test('a report with a screenshot reaches Discord as one multipart post', async () => {
  let received: { type: string; body: string } | null = null;
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      received = { type: String(req.headers['content-type']), body: Buffer.concat(chunks).toString('latin1') };
      res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;
  try {
    const service = new BetaReportService(settingsWith({ beta: true, webhook: `${base}/api/webhooks/123/token-abc` }), base);
    const result = await service.send({ ...report, screenshot: { bytes: PNG, mime: 'image/png', ext: 'png' } });
    assert.deepEqual(result, { ok: true });
    assert.ok(received);
    const got = received as { type: string; body: string };
    assert.match(got.type, /^multipart\/form-data/);
    assert.match(got.body, /name="payload_json"/);
    assert.match(got.body, /name="files\[0\]"; filename="screenshot\.png"/);
    assert.ok(got.body.includes(PNG.toString('latin1')));

    // An address that is not a Discord webhook is refused even if it was stored.
    const off = new BetaReportService(settingsWith({ beta: true, webhook: 'http://10.0.0.1/api/webhooks/1/a' }), base);
    assert.deepEqual(await off.send(report), { ok: false, error: 'invalid webhook URL' });
  } finally {
    server.close();
  }
});
