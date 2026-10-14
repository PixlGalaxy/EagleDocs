// End-to-end check of phase 1 against two replicas (A: 4001, B: 4002) sharing one Postgres.
import net from 'net';

const A = process.env.E2E_A ?? 'http://localhost:4001/api';
const B = process.env.E2E_B ?? 'http://localhost:4002/api';
const ADMIN = process.env.E2E_ADMIN ?? 'pixl';
const SMTP_HOST = process.env.E2E_SMTP_HOST ?? 'localhost';
let failures = 0;
const check = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ` (${extra})` : ''}`);
  if (!cond) failures++;
};

// --- fake SMTP server capturing messages
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
await new Promise((r) => smtp.listen(2525, r));

// --- tiny cookie-aware client
class Client {
  jar = {};
  async req(base, method, path, body, { csrf = true } = {}) {
    const headers = { cookie: Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join('; ') };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (csrf && this.jar.csrf && method !== 'GET') headers['x-csrf-token'] = decodeURIComponent(this.jar.csrf);
    const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const [k, ...v] = pair.split('=');
      const value = v.join('=');
      if (value === '' || /Expires=Thu, 01 Jan 1970/.test(c)) delete this.jar[k];
      else this.jar[k] = value;
    }
    const text = await res.text();
    let json;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = text;
    }
    return { status: res.status, json };
  }
}

const admin = new Client();
let r = await admin.req(A, 'GET', '/config');
check('config loads', r.status === 200 && r.json.appName === 'EagleDocs', JSON.stringify(r.json).slice(0, 120));
check('csrf cookie set', !!admin.jar.csrf);

r = await admin.req(A, 'POST', '/auth/login', { usernameOrEmail: ADMIN, password: 'change-me-now' }, { csrf: false });
check('login without csrf header is refused', r.status === 403, r.json?.error);
r = await admin.req(A, 'POST', '/auth/login', { usernameOrEmail: ADMIN.toUpperCase(), password: 'change-me-now' });
check('admin login on A (case-insensitive)', r.status === 200 && r.json.user.role === 'admin', r.status);
r = await admin.req(B, 'GET', '/auth/me');
check('session works on B', r.status === 200 && r.json.user.username === ADMIN);

r = await admin.req(B, 'GET', '/admin/overview');
check('overview', r.status === 200 && r.json.nodes_online === 2 && r.json.alerts.length === 2, JSON.stringify(r.json));

// --- institution + smtp
r = await admin.req(B, 'POST', '/admin/institutions', {
  name: 'Florida Gulf Coast University',
  canvas_base_url: 'https://canvas.fgcu.edu',
  domains: [{ domain: 'fgcu.edu', include_subdomains: true }],
  skills: {},
});
check('create institution', r.status === 201 && r.json.slug === 'florida-gulf-coast-university', JSON.stringify(r.json));
const instId = r.json.id;
r = await admin.req(A, 'POST', '/admin/institutions', { name: 'Other', domains: [{ domain: 'FGCU.edu' }] });
check('duplicate domain refused', r.status === 409, r.json?.error);

const student = new Client();
await student.req(A, 'GET', '/config');
r = await student.req(A, 'POST', '/auth/register', { email: 'ana@eagle.fgcu.edu', username: 'ana', password: 'password123', displayName: 'Ana' });
check('register refused while SMTP missing', r.status === 503, r.json?.error);

r = await admin.req(A, 'PUT', '/admin/smtp', { host: SMTP_HOST, port: 2525, secure: false, user: '', password: 'secret-pass', from_name: 'EagleDocs', from_email: 'no-reply@eagledocs.org' });
check('save smtp', r.status === 200 && r.json.password_set === true && !('password' in r.json), JSON.stringify(r.json));
await new Promise((res) => setTimeout(res, 300)); // NOTIFY reaches B
r = await student.req(B, 'GET', '/config');
check('B sees smtp configured via NOTIFY', r.json.emailConfigured === true && r.json.institutions[0]?.domains[0] === 'fgcu.edu');

r = await admin.req(B, 'POST', '/admin/smtp/test', { to: 'pixl@example.com' });
check('smtp test email', r.status === 204 && mails.length === 1, r.json?.error);

// --- registration
r = await student.req(A, 'POST', '/auth/register', { email: 'ana@gmail.com', username: 'ana', password: 'password123', displayName: 'Ana' });
check('foreign domain refused', r.status === 403, r.json?.error);
r = await student.req(A, 'POST', '/auth/register', { email: 'ana@eagle.fgcu.edu', username: 'ana', password: 'password123', displayName: 'Ana' });
check('register with subdomain', r.status === 201 && r.json.email === 'ana@eagle.fgcu.edu', JSON.stringify(r.json));
const mail = mails.at(-1);
const code = mail.match(/\b(\d{6})\b/)?.[1];
const token = mail.match(/verify\?token=([A-Za-z0-9_-]+)/)?.[1];
check('email has code and link', !!code && !!token);

r = await student.req(B, 'POST', '/auth/login', { usernameOrEmail: 'ana', password: 'password123' });
check('pending cannot log in (403)', r.status === 403, r.json?.error);
r = await student.req(B, 'POST', '/auth/register', { email: 'ana@eagle.fgcu.edu', username: 'ana2', password: 'hijacked99' });
check('re-register pending only resends', r.status === 201 && mails.length === 3);
const code2 = mails.at(-1).match(/\b(\d{6})\b/)?.[1];
r = await student.req(B, 'POST', '/auth/verify', { email: 'ana@eagle.fgcu.edu', code: code === code2 ? '000000' : code });
check('old code no longer works', r.status === 400, r.json?.error);
r = await student.req(A, 'POST', '/auth/verify', { email: 'ana@eagle.fgcu.edu', code: code2 });
check('verify with code signs in', r.status === 200 && r.json.user.status === 'active' && r.json.user.institution_name === 'Florida Gulf Coast University');
r = await student.req(B, 'GET', '/auth/me');
check('student session on B', r.status === 200 && r.json.user.username === 'ana');
r = await student.req(A, 'POST', '/auth/login', { usernameOrEmail: 'ana', password: 'hijacked99' });
check('hijack password never set', r.status === 401);

const linkUser = new Client();
await linkUser.req(A, 'GET', '/config');
await linkUser.req(A, 'POST', '/auth/register', { email: 'leo@fgcu.edu', username: 'leo', password: 'password123' });
const leoToken = mails.at(-1).match(/verify\?token=([A-Za-z0-9_-]+)/)?.[1];
r = await linkUser.req(B, 'POST', '/auth/verify', { token: leoToken });
check('verify by link', r.status === 200 && r.json.user.username === 'leo', r.json?.error);
r = await linkUser.req(B, 'POST', '/auth/verify', { token: leoToken });
check('link single use', r.status === 400);

// --- profile & appearance
r = await student.req(A, 'PATCH', '/auth/profile', { major: 'Computer Science', timezone: 'America/New_York' });
check('profile update', r.status === 200 && r.json.major === 'Computer Science');
r = await student.req(A, 'POST', '/auth/appearance', { mode: 'dark', skin: 'ocean', language: 'es' });
check('appearance update', r.status === 200 && r.json.language === 'es');
r = await student.req(A, 'GET', '/admin/overview');
check('student cannot reach admin, error in Spanish', r.status === 403 && /permiso/.test(r.json.error), r.json?.error);

// --- forgot / reset
const before = mails.length;
r = await student.req(B, 'POST', '/auth/forgot-password', { email: 'ana@eagle.fgcu.edu' });
check('forgot password', r.status === 204 && mails.length === before + 1);
const resetToken = mails.at(-1).match(/reset-password\?token=([A-Za-z0-9_-]+)/)?.[1];
r = await student.req(A, 'POST', '/auth/reset-password', { token: resetToken, newPassword: 'newpass456' });
check('reset password', r.status === 204, r.json?.error);
r = await student.req(A, 'GET', '/auth/me');
check('reset signs out everywhere', r.status === 401);
r = await student.req(A, 'POST', '/auth/reset-password', { token: resetToken, newPassword: 'again789x' });
check('reset token single use', r.status === 400);
r = await student.req(B, 'POST', '/auth/login', { usernameOrEmail: 'ana@eagle.fgcu.edu', password: 'newpass456' });
check('login with new password', r.status === 200);

// --- admin users
r = await admin.req(A, 'GET', '/admin/users?q=ana');
check('admin list search', r.status === 200 && r.json.length === 1 && 'last_seen_at' in r.json[0] && !('password_hash' in r.json[0]));
const anaId = r.json[0].id;
r = await admin.req(A, 'GET', '/auth/me');
const pixlId = r.json.user.id;
r = await admin.req(B, 'PATCH', `/admin/users/${pixlId}`, { role: 'user' });
check('last admin cannot be demoted', r.status === 409, r.json?.error);
r = await admin.req(B, 'POST', '/admin/users', { email: 'ops@eagledocs.org', username: 'ops', display_name: 'Ops', password: 'opspass123', role: 'admin', tier_id: null });
check('create second admin', r.status === 201 && r.json.status === 'active');
r = await admin.req(B, 'PATCH', `/admin/users/${pixlId}`, { username: 'pixlgalaxy', email: 'pixl@eagledocs.org' });
check('admin edits own username and email', r.status === 200 && r.json.username === 'pixlgalaxy');
r = await admin.req(A, 'PATCH', `/admin/users/${anaId}`, { status: 'disabled' });
check('disable user', r.status === 200 && r.json.status === 'disabled');
r = await student.req(B, 'GET', '/auth/me');
check('disabled user loses session', r.status === 401);
r = await admin.req(A, 'DELETE', `/admin/users/${pixlId}`);
check('cannot delete self', r.status === 400);

// --- settings
r = await admin.req(A, 'PATCH', '/admin/settings', { registration_enabled: false, app_title: 'EagleDocs Test' });
check('patch settings', r.status === 200 && r.json.registration_enabled === false);
await new Promise((res) => setTimeout(res, 300));
r = await student.req(B, 'POST', '/auth/register', { email: 'bob@fgcu.edu', username: 'bob', password: 'password123' });
check('registration closed on B', r.status === 403, r.json?.error);
await admin.req(A, 'PATCH', '/admin/settings', { registration_enabled: true });

r = await admin.req(B, 'GET', '/admin/logs?level=warn');
check('logs (cluster-wide, warn+)', r.status === 200 && r.json.entries.length > 0 && r.json.entries.every((l) => l.level !== 'INFO') && r.json.nodes.length >= 2, JSON.stringify(r.json?.nodes));
r = await admin.req(B, 'GET', '/admin/logs?channel=AUTH&limit=200');
check('logs channel filter', r.status === 200 && r.json.entries.every((l) => l.channel === 'AUTH') && r.json.entries.length > 0);
r = await student.req(B, 'GET', '/admin/logs');
check('logs are admin only', r.status === 401 || r.status === 403);
r = await admin.req(B, 'GET', '/admin/nodes');
check('nodes', r.status === 200 && r.json.length === 2 && r.json.every((n) => n.online));

// --- shared login rate limit
const attacker = new Client();
await attacker.req(A, 'GET', '/config');
let last;
for (let i = 0; i < 11; i++) last = await attacker.req(i % 2 ? A : B, 'POST', '/auth/login', { usernameOrEmail: 'ops', password: 'wrong-pass' });
check('rate limit shared across replicas', last.status === 429, last.status);

r = await admin.req(A, 'DELETE', `/admin/institutions/${instId}`);
check('delete institution', r.status === 204);

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
smtp.close();
process.exit(failures ? 1 : 0);
