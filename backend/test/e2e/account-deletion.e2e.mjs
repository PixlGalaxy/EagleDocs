// Account deletion end-to-end: the owner deletes their account (30 days to change their mind), signing in again
// restores it, Stripe is cancelled at once, an admin deletes an account at once, and the leader task erases accounts
// whose 30 days are over. Runs a fake Stripe API on port 4994.
//
// Needs a dev backend (dev seed accounts) started with STRIPE_API_BASE=http://localhost:4994, and:
//   E2E_DB    its DATABASE_URL (the dev log prints the embedded Postgres port)
//   E2E_DATA  its DATA_ROOT, to check what is left on disk
// Two phases: `E2E_PHASE=1` (default) does the requests and moves one deletion date into the past;
// restart the backend (the purge runs ~10 s after boot), then run `E2E_PHASE=2` to check the purge.
import { createHmac } from 'node:crypto';
import { existsSync } from 'node:fs';
import http from 'node:http';
import { join } from 'node:path';
import pg from 'pg';

const A = process.env.E2E_A ?? 'http://localhost:4000/api';
const DATA = process.env.E2E_DATA;
const PHASE = process.env.E2E_PHASE ?? '1';
const STRIPE_PORT = 4994;
const WEBHOOK_SECRET = 'whsec_e2eDeletion1234567890';
if (!process.env.E2E_DB || !DATA) throw new Error('Set E2E_DB (DATABASE_URL) and E2E_DATA (DATA_ROOT) of the backend under test');
const db = new pg.Client({ connectionString: process.env.E2E_DB });
await db.connect();

let failures = 0;
const check = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ` (${extra})` : ''}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class Client {
  jar = {};
  headers(method, body) {
    const h = { cookie: Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join('; ') };
    if (body !== undefined) h['content-type'] = 'application/json';
    if (this.jar.csrf && method !== 'GET') h['x-csrf-token'] = decodeURIComponent(this.jar.csrf);
    return h;
  }
  async req(method, path, body) {
    const res = await fetch(A + path, { method, headers: this.headers(method, body), body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of res.headers.getSetCookie()) {
      const [k, ...v] = c.split(';')[0].split('=');
      this.jar[k] = v.join('=');
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
  /** Uploads one text file to the workspace root, like the Files page. */
  async upload(name, text) {
    const form = new FormData();
    form.append('file', new Blob([text], { type: 'text/plain' }), name);
    const res = await fetch(`${A}/files/upload?path=`, { method: 'POST', headers: { cookie: this.headers('GET').cookie, 'x-csrf-token': decodeURIComponent(this.jar.csrf) }, body: form });
    return res.status;
  }
}
const session = async (u, p) => {
  const c = new Client();
  await c.req('GET', '/config');
  const r = await c.req('POST', '/auth/login', { usernameOrEmail: u, password: p });
  return { c, r };
};
const login = async (u, p) => {
  const { c, r } = await session(u, p);
  if (r.status !== 200) throw new Error(`login ${u}: ${r.status} ${JSON.stringify(r.json)}`);
  return c;
};
const userRow = (username) => db.query('SELECT id, status, delete_after, tier_id FROM users WHERE username = $1', [username]).then((r) => r.rows[0]);
const workspace = (id) => join(DATA, 'workspaces', id);

if (PHASE === '2') {
  // ------------------------------------------------------------ after a restart: the leader task erased "user"
  // Not a dev seed account: the seed sets those back to active on every boot.
  let row;
  for (let i = 0; i < 60 && (row = await userRow('graceuser')); i++) await sleep(500);
  check('the account whose 30 days were over is erased by the leader task', !row);
  const id = process.env.E2E_USER_ID;
  if (id) check('its workspace is gone from disk', !existsSync(workspace(id)), workspace(id));
  const { r } = await session('graceuser', 'grace-user-password-1');
  check('it cannot sign in any more', r.status === 401, String(r.status));
  await db.end();
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
}

// ---------------------------------------------------------------- fake Stripe
const stripeCalls = [];
const stripe = http.createServer(async (req, res) => {
  stripeCalls.push({ method: req.method, path: req.url });
  res.setHeader('content-type', 'application/json');
  if (req.method === 'DELETE' && req.url.startsWith('/v1/subscriptions/')) return res.end(JSON.stringify({ id: req.url.split('/').pop(), status: 'canceled' }));
  res.end('{}');
});
await new Promise((resolve) => stripe.listen(STRIPE_PORT, resolve));
async function webhook(type, object) {
  const body = JSON.stringify({ id: `evt_del_${Date.now()}_${Math.random()}`, type, data: { object } });
  const t = Math.floor(Date.now() / 1000);
  const sig = `t=${t},v1=${createHmac('sha256', WEBHOOK_SECRET).update(`${t}.${body}`).digest('hex')}`;
  return fetch(`${A}/billing/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': sig }, body });
}

const admin = await login('admin', 'admin');
let user = await login('user', 'user');
const before = await userRow('user');

// A paid plan through Stripe, and a file in the workspace.
const tiers = (await admin.req('GET', '/admin/tiers')).json;
const plus = tiers.find((t) => t.name === 'Plus');
await admin.req('PUT', '/admin/billing', { stripe_secret_key: 'sk_test_e2eDeletionKey1234567890', stripe_webhook_secret: WEBHOOK_SECRET, enabled: true });
await admin.req('PUT', `/admin/tiers/${plus.id}`, { enabled: true, stripe_price_id: 'price_DelE2E123' });
await webhook('checkout.session.completed', { client_reference_id: before.id, customer: 'cus_del1', subscription: 'sub_del1', metadata: { tier_id: plus.id } });
check('the student has the paid plan', (await userRow('user')).tier_id === plus.id);
const uploaded = await user.upload('notes.md', 'Exam on Friday');
check('a file is saved in the workspace', uploaded < 300 && existsSync(join(workspace(before.id), 'notes.md')), String(uploaded));
let r;

// ---------------------------------------------------------------- the owner deletes the account
r = await user.req('POST', '/auth/delete-account', { password: 'user', username: 'someone' });
check('the username must match', r.status === 400, r.json?.code);
r = await user.req('POST', '/auth/delete-account', { password: 'wrong-password', username: 'user' });
check('the password must be right', r.status === 401, r.json?.code);
r = await user.req('POST', '/auth/delete-account', { password: 'user', username: 'USER' });
const days = r.json ? (new Date(r.json.delete_after).getTime() - Date.now()) / 86_400_000 : 0;
check('deleting with the right password works (username in any case)', r.status === 200 && days > 29.9 && days < 30.1, `${r.status} ${days.toFixed(2)} days`);
check('Stripe is cancelled at once', stripeCalls.some((c) => c.method === 'DELETE' && c.path === '/v1/subscriptions/sub_del1'), JSON.stringify(stripeCalls));
let row = await userRow('user');
check('the account waits to be deleted, without the paid plan', row.status === 'deleting' && row.tier_id === null, `${row.status} ${row.tier_id}`);
r = await user.req('GET', '/auth/me');
check('its session is closed', r.status === 401, String(r.status));
check('its files are still there during the 30 days', existsSync(join(workspace(before.id), 'notes.md')));

// ---------------------------------------------------------------- signing in again keeps it
const back = await session('user', 'user');
check('signing in again restores the account', back.r.status === 200 && back.r.json?.restored === true && back.r.json?.user?.status === 'active', JSON.stringify(back.r.json?.restored));
row = await userRow('user');
check('it is active again, with no deletion date', row.status === 'active' && row.delete_after === null);
r = await back.c.req('GET', '/auth/me');
check('the new session works', r.status === 200, String(r.status));
r = await (await login('user', 'user')).req('GET', '/auth/me');
check('a normal sign-in says nothing about a restore', r.status === 200);

// Deleting again: the subscription is already cancelled, so Stripe is not called a second time.
user = back.c;
const callsBefore = stripeCalls.length;
r = await user.req('POST', '/auth/delete-account', { password: 'user', username: 'user' });
check('it can be deleted again', r.status === 200, String(r.status));
check('an already cancelled subscription is not cancelled twice', stripeCalls.length === callsBefore, JSON.stringify(stripeCalls.slice(callsBefore)));

// ---------------------------------------------------------------- the last admin cannot delete themselves
r = await admin.req('POST', '/auth/delete-account', { password: 'admin', username: 'admin' });
check('the last active admin cannot delete their own account', r.status === 409, r.json?.code);

// ---------------------------------------------------------------- an admin deletes an account at once
r = await admin.req('POST', '/admin/users', { email: 'temp-del@studyhawk.test', username: 'tempdel', password: 'temp-del-password-1', display_name: 'Temp' });
check('a throwaway account is created', r.status === 201, String(r.status));
const temp = await login('tempdel', 'temp-del-password-1');
await temp.upload('draft.md', 'x');
const tempId = (await userRow('tempdel')).id;
check('its file is on disk', existsSync(join(workspace(tempId), 'draft.md')));
r = await admin.req('DELETE', `/admin/users/${tempId}`);
check('the admin deletes it', r.status < 300, String(r.status));
check('it is erased at once, row and files', !(await userRow('tempdel')) && !existsSync(workspace(tempId)));
r = (await session('tempdel', 'temp-del-password-1')).r;
check('it cannot sign in', r.status === 401, String(r.status));

// ---------------------------------------------------------------- the 30 days are over (for phase 2)
// "user" is reset by the dev seed at every boot, so phase 2 uses an account of its own.
await admin.req('POST', '/admin/users', { email: 'grace@studyhawk.test', username: 'graceuser', password: 'grace-user-password-1', display_name: 'Grace' });
const grace = await login('graceuser', 'grace-user-password-1');
await grace.upload('essay.md', 'draft');
r = await grace.req('POST', '/auth/delete-account', { password: 'grace-user-password-1', username: 'graceuser' });
check('a second account asks to be deleted', r.status === 200, String(r.status));
const graceId = (await userRow('graceuser')).id;
await db.query("UPDATE users SET delete_after = now() - interval '1 minute' WHERE id = $1", [graceId]);
console.log(`\nNext: restart the backend, then run with E2E_PHASE=2 E2E_USER_ID=${graceId}`);

stripe.close();
await db.end();
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
