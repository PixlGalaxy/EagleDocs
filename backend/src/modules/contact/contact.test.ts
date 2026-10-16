import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AppError } from '../../errors.js';
import { renderContactEmail } from '../mail/templates.js';
import { discordPayload, isDiscordWebhookUrl, parseContactInput } from './contact.service.js';

const valid = { name: 'Ana Pérez', email: 'Ana@Example.com', message: 'Hello, I have a question about plans.' };
const keyOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return err instanceof AppError ? err.key : 'not an AppError';
  }
  return 'no error';
};

test('contact input is trimmed and normalized', () => {
  const input = parseContactInput({ name: '  Ana\u0000 \u202ePérez\t ', email: ' Ana@Example.com ', message: '\r\n Line one\r\nLine two\u0007\tend  ' });
  assert.deepEqual(input, { name: 'Ana Pérez', email: 'ana@example.com', message: 'Line one\nLine two\tend' });
});

test('contact input limits', () => {
  assert.equal(keyOf(() => parseContactInput({ ...valid, name: '   ' })), 'contact.invalidName');
  assert.equal(keyOf(() => parseContactInput({ ...valid, name: 'a'.repeat(101) })), 'contact.invalidName');
  assert.equal(keyOf(() => parseContactInput({ ...valid, name: 'a'.repeat(100) })), 'no error');
  assert.equal(keyOf(() => parseContactInput({ ...valid, email: 'not-an-email' })), 'users.invalidEmail');
  assert.equal(keyOf(() => parseContactInput({ ...valid, email: `${'a'.repeat(250)}@x.io` })), 'users.invalidEmail');
  // Control characters in an address are refused, never repaired (it becomes a Reply-To header).
  assert.equal(keyOf(() => parseContactInput({ ...valid, email: 'ana@example.com\u0001' })), 'users.invalidEmail');
  assert.equal(keyOf(() => parseContactInput({ ...valid, email: 'ana@exa\u0001mple.com' })), 'users.invalidEmail');
  assert.equal(keyOf(() => parseContactInput({ ...valid, message: '  short   ' })), 'contact.invalidMessage');
  assert.equal(keyOf(() => parseContactInput({ ...valid, message: 'x'.repeat(5001) })), 'contact.invalidMessage');
  assert.equal(keyOf(() => parseContactInput({ ...valid, message: 'x'.repeat(5000) })), 'no error');
  // Ten characters only after the control characters are gone.
  assert.equal(keyOf(() => parseContactInput({ ...valid, message: '\u0000\u0000\u0000\u0000\u0000123456789' })), 'contact.invalidMessage');
  assert.equal(keyOf(() => parseContactInput({ ...valid, name: 42 })), 'error.invalidInput');
  assert.equal(keyOf(() => parseContactInput({ email: valid.email, message: valid.message })), 'error.invalidInput');
});

test('repeated control-character checks do not depend on earlier calls', () => {
  for (let i = 0; i < 3; i++) {
    assert.equal(keyOf(() => parseContactInput({ ...valid, email: 'a\u0001b@example.com' })), 'users.invalidEmail');
    assert.equal(keyOf(() => parseContactInput(valid)), 'no error');
  }
});

test('only Discord webhook URLs are accepted', () => {
  const ok = [
    'https://discord.com/api/webhooks/123456789012345678/abcDEF_-123',
    'https://discordapp.com/api/webhooks/1/token',
    'https://ptb.discord.com/api/webhooks/1/token',
    'https://canary.discord.com/api/webhooks/1/token/',
    'https://canary.discordapp.com/api/v10/webhooks/1/token',
  ];
  for (const url of ok) assert.equal(isDiscordWebhookUrl(url), true, url);
  const bad = [
    'http://discord.com/api/webhooks/1/token',
    'https://discord.com:8443/api/webhooks/1/token',
    'https://evil.com/api/webhooks/1/token',
    'https://discord.com.evil.com/api/webhooks/1/token',
    'https://evil.discord.com/api/webhooks/1/token',
    'https://user:pass@discord.com/api/webhooks/1/token',
    'https://discord.com/api/webhooks/1/token?wait=true',
    'https://discord.com/api/webhooks/1/token#x',
    'https://discord.com/api/webhooks/abc/token',
    'https://discord.com/api/webhooks/1/token/extra',
    'https://discord.com/api/webhooks/1/../../users/@me',
    'https://discord.com/other',
    'https://127.0.0.1/api/webhooks/1/token',
    'http://localhost:4993/api/webhooks/1/token',
    'https://169.254.169.254/api/webhooks/1/token',
    'not a url',
    `https://discord.com/api/webhooks/1/${'a'.repeat(600)}`,
  ];
  for (const url of bad) assert.equal(isDiscordWebhookUrl(url), false, url);
});

test('the test override admits only its own local fake', () => {
  const base = 'http://127.0.0.1:4993';
  assert.equal(isDiscordWebhookUrl('http://127.0.0.1:4993/api/webhooks/1/token', base), true);
  assert.equal(isDiscordWebhookUrl('http://127.0.0.1:4994/api/webhooks/1/token', base), false);
  assert.equal(isDiscordWebhookUrl('http://127.0.0.1:4993/admin', base), false);
  assert.equal(isDiscordWebhookUrl('http://10.0.0.5:4993/api/webhooks/1/token', 'http://10.0.0.5:4993'), false);
  assert.equal(isDiscordWebhookUrl('http://127.0.0.1:4993/api/webhooks/1/token', 'not a url'), false);
  // The real rule still holds next to it.
  assert.equal(isDiscordWebhookUrl('https://discord.com/api/webhooks/1/token', base), true);
  assert.equal(isDiscordWebhookUrl('https://evil.com/api/webhooks/1/token', base), false);
});

test('the Discord payload pings nobody and stays in the embed limits', () => {
  const input = { name: '@everyone <@&123> '.repeat(5).slice(0, 100), email: 'a@b.co', message: '@here '.repeat(1000).slice(0, 5000) };
  const payload = discordPayload(input, { title: 'T'.repeat(300), name: 'Name', email: 'Email' });
  assert.deepEqual(payload.allowed_mentions, { parse: [] });
  assert.equal(payload.content, '');
  const embed = payload.embeds[0]!;
  assert.ok(embed.title.length <= 256);
  assert.ok(embed.description.length <= 4096);
  assert.ok(embed.description.endsWith('…'));
  for (const field of embed.fields) {
    assert.ok(field.name.length <= 256 && field.value.length <= 1024 && field.value.length > 0);
  }
  const total = embed.title.length + embed.description.length + embed.fields.reduce((n, f) => n + f.name.length + f.value.length, 0);
  assert.ok(total <= 6000, String(total));
  assert.equal(embed.fields[0]!.value, input.name);
  // A message within the limit is passed as is.
  assert.equal(discordPayload({ ...input, message: 'short message' }, { title: 't', name: 'n', email: 'e' }).embeds[0]!.description, 'short message');
});

test('the contact email escapes the visitor text', () => {
  const email = renderContactEmail({ appName: 'StudyHawk', intro: '<b>x</b> wrote:', message: '<script>alert(1)</script>\n"hi" & bye', footer: ['Reply'] });
  assert.ok(!email.html.includes('<script>'));
  assert.ok(email.html.includes('&lt;script&gt;alert(1)&lt;/script&gt;\n&quot;hi&quot; &amp; bye'));
  assert.ok(email.html.includes('&lt;b&gt;x&lt;/b&gt;'));
  assert.ok(email.text.includes('<script>alert(1)</script>'));
});
