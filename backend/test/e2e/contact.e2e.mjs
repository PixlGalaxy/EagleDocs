// End-to-end check of the public Contact form: email (fake SMTP) and Discord (fake webhook), plus Admin -> Email.
// Start the backend with DISCORD_WEBHOOK_TEST_BASE pointing at the fake Discord (development only), on a fresh database:
// it uses up rate limits on purpose.
import http from 'http';
import net from 'net';

const A = process.env.E2E_A ?? 'http://localhost:4000/api';
const SMTP_PORT = Number(process.env.E2E_SMTP_PORT ?? 2526);
const DISCORD_PORT = Number(process.env.E2E_DISCORD_PORT ?? 4993);
const DISCORD = `http://127.0.0.1:${DISCORD_PORT}`;
let failures = 0;
const check = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ` (${extra})` : ''}`);
  if (!cond) failures++;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// --- fake SMTP server capturing messages (headers and body, quoted-printable soft breaks undone)
const mails = [];
const smtp = net.createServer((sock) => {
  let data = false;
  let buf = '';
  sock.write('220 fake ESMTP\r\n');
  sock.on('data', (chunk) => {
    buf += chunk.toString();
    let idx;
    while ((idx = buf.indexOf('\r\n')) >= 0) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      if (data) {
        if (line === '.') {
          data = false;
          mails[mails.length - 1] = mails[mails.length - 1].replace(/=\n/g, '').replace(/=3D/g, '=');
          sock.write('250 OK\r\n');
        } else mails[mails.length - 1] += line + '\n';
        continue;
      }
      const cmd = line.slice(0, 4).toUpperCase();
      if (cmd === 'EHLO' || cmd === 'HELO') sock.write('250 fake\r\n');
      else if (cmd === 'DATA') {
        data = true;
        mails.push('');
        sock.write('354 go\r\n');
      } else if (cmd === 'QUIT') {
        sock.write('221 bye\r\n');
        sock.end();
      } else sock.write('250 OK\r\n');
    }
  });
});
await new Promise((r) => smtp.listen(SMTP_PORT, r));

// --- fake Discord: /1/ok accepts, /2/fail answers 500, /3/redirect bounces to /1/ok
const posts = [];
const discord = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    posts.push({ path: req.url, type: req.headers['content-type'], body: body ? JSON.parse(body) : null });
    if (req.url === '/api/webhooks/1/ok') return res.writeHead(204).end();
    if (req.url === '/api/webhooks/3/redirect') return res.writeHead(307, { location: `${DISCORD}/api/webhooks/1/ok` }).end();
    res.writeHead(500).end('boom');
  });
});
await new Promise((r) => discord.listen(DISCORD_PORT, '127.0.0.1', r));

// --- tiny cookie-aware client; `ip` goes in X-Forwarded-For (loopback is a trusted proxy) to spread the rate limits
class Client {
  jar = {};
  async req(method, path, body, { csrf = true, ip } = {}) {
    const headers = { cookie: Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join('; ') };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (csrf && this.jar.csrf && method !== 'GET') headers['x-csrf-token'] = decodeURIComponent(this.jar.csrf);
    if (ip) headers['x-forwarded-for'] = ip;
    const res = await fetch(A + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const [k, ...v] = pair.split('=');
      this.jar[k] = v.join('=');
    }
    const raw = await res.text();
    let json;
    try {
      json = raw ? JSON.parse(raw) : undefined;
    } catch {
      json = raw;
    }
    return { status: res.status, json, raw };
  }
}

const visitor = new Client();
await visitor.req('GET', '/config');
const msg = (over = {}) => ({ name: 'Ana Pérez', email: 'ana@example.com', message: 'Hello! I have a question about StudyHawk plans.', website: '', ...over });

// --- nothing configured yet
let r = await visitor.req('POST', '/contact', msg(), { ip: '10.9.0.1' });
check('nothing configured: 503 the page can show', r.status === 503 && r.json?.code === 'contact.unavailable' && typeof r.json.error === 'string', JSON.stringify(r.json));
r = await visitor.req('POST', '/contact', msg(), { ip: '10.9.0.1', csrf: false });
check('no CSRF token: refused', r.status === 403);
r = await visitor.req('GET', '/admin/contact');
check('visitor cannot read the admin settings', r.status === 401 || r.status === 403, r.status);

const admin = new Client();
await admin.req('GET', '/config');
r = await admin.req('POST', '/auth/login', { usernameOrEmail: 'admin', password: 'admin' });
check('admin login (dev seed)', r.status === 200, r.status);
r = await admin.req('GET', '/admin/contact');
check('default destination, no webhook', r.status === 200 && r.json.email_to === 'support@studyhawk.app' && r.json.discord_webhook_set === false, JSON.stringify(r.json));

// --- the webhook URL rule
for (const bad of [
  'http://169.254.169.254/api/webhooks/1/ok',
  'https://evil.example.com/api/webhooks/1/ok',
  'https://discord.com.evil.example.com/api/webhooks/1/ok',
  `${DISCORD}/admin`,
  'http://127.0.0.1:4000/api/webhooks/1/ok',
  'https://discord.com/api/webhooks/1/ok?x=1',
]) {
  r = await admin.req('PUT', '/admin/contact', { email_to: '', discord_webhook_url: bad });
  check(`webhook refused: ${bad}`, r.status === 400 && r.json?.code === 'contact.invalidWebhook', r.status);
}
r = await admin.req('PUT', '/admin/contact', { email_to: 'not-an-email' });
check('bad destination refused', r.status === 400, r.status);

// --- configure both channels
r = await admin.req('PUT', '/admin/smtp', { host: 'localhost', port: SMTP_PORT, secure: false, user: '', from_name: 'StudyHawk', from_email: 'no-reply@studyhawk.app' });
check('save smtp', r.status === 200, r.status);
r = await admin.req('PUT', '/admin/contact', { email_to: 'Inbox@Example.com', discord_webhook_url: `${DISCORD}/api/webhooks/1/ok` });
check('save contact settings', r.status === 200 && r.json.email_to === 'inbox@example.com' && r.json.discord_webhook_set === true && r.json.smtp_configured === true, JSON.stringify(r.json));
check('the webhook URL is never returned', !r.raw.includes('webhooks'));
r = await admin.req('GET', '/admin/contact');
check('GET does not return it either', r.status === 200 && !r.raw.includes('webhooks') && r.json.discord_webhook_set === true);
r = await admin.req('PUT', '/admin/contact', { email_to: 'inbox@example.com' });
check('absent webhook keeps it', r.json?.discord_webhook_set === true);

// --- admin test through both channels
let mailCount = mails.length;
let postCount = posts.length;
r = await admin.req('POST', '/admin/contact/test');
await wait(200);
check('test reports both sent', r.status === 200 && r.json.email.status === 'sent' && r.json.discord.status === 'sent', JSON.stringify(r.json));
check('test email arrived', mails.length === mailCount + 1 && /Subject: \[test\]/.test(mails.at(-1)) && /To: inbox@example\.com/.test(mails.at(-1)));
check('test post arrived', posts.length === postCount + 1 && posts.at(-1).body.content.length > 0 && posts.at(-1).type === 'application/json');

// --- a real message
mailCount = mails.length;
postCount = posts.length;
const evil = 'Hi <script>alert(1)</script> @everyone @here <@&123456> please answer, thanks!\nSecond line.';
r = await visitor.req('POST', '/contact', msg({ name: '  Ana\u0007 Pérez ', email: ' Ana@Example.com ', message: evil }), { ip: '10.9.0.2' });
await wait(200);
check('message accepted', r.status === 204, JSON.stringify(r.json));
const mail = mails.at(-1) ?? '';
check('email sent to the destination', mails.length === mailCount + 1 && /To: inbox@example\.com/.test(mail));
check('Reply-To is the sender', /Reply-To: .*ana@example\.com/i.test(mail), mail.split('\n').find((l) => /^Reply-To/i.test(l)));
check('HTML escapes the message', mail.includes('&lt;script&gt;') && !/<script>alert/.test(mail.split(/Content-Type: text\/html/i)[1] ?? '<script>alert'));
const post = posts.at(-1);
check('Discord post arrived', posts.length === postCount + 1 && post.path === '/api/webhooks/1/ok');
check('Discord pings nobody', JSON.stringify(post.body.allowed_mentions) === '{"parse":[]}' && post.body.content === '');
check('Discord embed has name, email and message', post.body.embeds[0].description === evil && post.body.embeds[0].fields.some((f) => f.value === 'Ana Pérez') && post.body.embeds[0].fields.some((f) => f.value === 'ana@example.com'), JSON.stringify(post.body.embeds[0].fields));

// --- honeypot and validation
mailCount = mails.length;
postCount = posts.length;
r = await visitor.req('POST', '/contact', msg({ website: 'http://spam.example' }), { ip: '10.9.0.3' });
await wait(200);
check('honeypot: success, nothing sent', r.status === 204 && mails.length === mailCount && posts.length === postCount);
r = await visitor.req('POST', '/contact', msg({ email: 'e@example.com', message: ' too short ' }), { ip: '10.9.0.4' });
check('short message: 400 with a message', r.status === 400 && r.json.code === 'contact.invalidMessage' && r.json.error.length > 0, JSON.stringify(r.json));
r = await visitor.req('POST', '/contact', msg({ name: 'x'.repeat(101), email: 'b@example.com' }), { ip: '10.9.0.4' });
check('long name: 400', r.status === 400 && r.json.code === 'contact.invalidName');
r = await visitor.req('POST', '/contact', msg({ email: 'nope', message: 'x'.repeat(5001) }), { ip: '10.9.0.4' });
check('bad email: 400', r.status === 400 && r.json.code === 'users.invalidEmail');
check('nothing sent for invalid input', mails.length === mailCount && posts.length === postCount);

// --- one channel down is still a success; both down is an error
r = await admin.req('PUT', '/admin/smtp', { host: 'localhost', port: 2599, secure: false, user: '', from_name: 'StudyHawk', from_email: 'no-reply@studyhawk.app' });
r = await visitor.req('POST', '/contact', msg({ email: 'c@example.com' }), { ip: '10.9.0.5' });
check('email down, Discord up: success', r.status === 204, JSON.stringify(r.json));
await admin.req('PUT', '/admin/contact', { email_to: 'inbox@example.com', discord_webhook_url: `${DISCORD}/api/webhooks/2/fail` });
r = await visitor.req('POST', '/contact', msg({ email: 'd@example.com' }), { ip: '10.9.0.5' });
check('both down: 503 sendFailed', r.status === 503 && r.json.code === 'contact.sendFailed', JSON.stringify(r.json));
r = await admin.req('POST', '/admin/contact/test');
check('test reports both failures', r.json.email.status === 'failed' && r.json.discord.status === 'failed' && r.json.discord.error === 'HTTP 500', JSON.stringify(r.json));

// --- redirects are not followed
await admin.req('PUT', '/admin/smtp', { host: 'localhost', port: SMTP_PORT, secure: false, user: '', from_name: 'StudyHawk', from_email: 'no-reply@studyhawk.app' });
await admin.req('PUT', '/admin/contact', { email_to: 'inbox@example.com', discord_webhook_url: `${DISCORD}/api/webhooks/3/redirect` });
postCount = posts.length;
r = await admin.req('POST', '/admin/contact/test');
await wait(200);
check('redirect: Discord failed, email sent', r.json.email.status === 'sent' && r.json.discord.status === 'failed', JSON.stringify(r.json));
check('redirect target never reached', posts.length === postCount + 1 && posts.at(-1).path === '/api/webhooks/3/redirect');

// --- clearing the webhook
r = await admin.req('PUT', '/admin/contact', { email_to: '', discord_webhook_url: '' });
check('webhook cleared, destination back to default', r.json.discord_webhook_set === false && r.json.email_to === 'support@studyhawk.app', JSON.stringify(r.json));
r = await admin.req('POST', '/admin/contact/test');
check('test: Discord off', r.json.discord.status === 'off' && r.json.email.status === 'sent', JSON.stringify(r.json));

// --- rate limits (the honeypot counts too, and sends nothing)
let statuses = [];
for (let i = 0; i < 6; i++) statuses.push((await visitor.req('POST', '/contact', msg({ email: `ip${i}@example.com`, website: 'x' }), { ip: '10.9.0.6' })).status);
check('6th message from one IP in an hour: 429', statuses.slice(0, 5).every((s) => s === 204) && statuses[5] === 429, statuses.join(','));
statuses = [];
for (let i = 0; i < 4; i++) statuses.push((await visitor.req('POST', '/contact', msg({ email: 'Flood@Example.com', website: 'x' }), { ip: `10.9.1.${i}` })).status);
check('4th message as one email in an hour: 429', statuses.slice(0, 3).every((s) => s === 204) && statuses[3] === 429, statuses.join(','));

// --- logs keep the message body and the webhook out
r = await admin.req('GET', '/admin/logs?limit=1000');
check('logs never contain the message or the webhook', r.status === 200 && !r.raw.includes('please answer') && !r.raw.includes('webhooks/'), r.status);

smtp.close();
discord.close();
console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
