// Daily summary end-to-end: the setting, the "send one now" preview and the leader task's morning push, built from
// Canvas without a model. A fake push service (this script) decrypts what StudyHawk sends. Needs a dev backend on
// E2E_A (dev seed accounts) and fake-canvas.mjs on 4998. Takes about two and a half minutes: it waits for the
// leader task's ticks (one a minute).
import { createDecipheriv, createECDH, createHmac, randomBytes } from 'node:crypto';
import http from 'node:http';

const A = process.env.E2E_A ?? 'http://localhost:4000/api';
const CANVAS = process.env.E2E_CANVAS ?? 'http://localhost:4998';
const TOKEN = 'canvas-test-token-0123456789';
const PUSH_PORT = 4995;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let failures = 0;
const check = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ` (${extra})` : ''}`);
  if (!cond) failures++;
};

// ---------------------------------------------------------------- the fake push service and "device"
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();
const device = createECDH('prime256v1');
device.generateKeys();
const authSecret = randomBytes(16);
const received = [];

function decrypt(body) {
  const salt = body.subarray(0, 16);
  const idLength = body[20];
  const asPublic = body.subarray(21, 21 + idLength);
  const data = body.subarray(21 + idLength);
  const prkKey = hmac(authSecret, device.computeSecret(asPublic));
  const ikm = hmac(prkKey, Buffer.concat([Buffer.from('WebPush: info\0'), device.getPublicKey(), asPublic, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const decipher = createDecipheriv('aes-128-gcm', hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01', 'binary')).subarray(0, 16), hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01', 'binary')).subarray(0, 12));
  decipher.setAuthTag(data.subarray(data.length - 16));
  const plain = Buffer.concat([decipher.update(data.subarray(0, data.length - 16)), decipher.final()]);
  return JSON.parse(plain.subarray(0, -1).toString());
}

const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try {
    received.push({ path: req.url, payload: decrypt(Buffer.concat(chunks)) });
    res.writeHead(201).end();
  } catch (err) {
    received.push({ path: req.url, error: err.message });
    res.writeHead(400).end();
  }
});
await new Promise((resolve) => server.listen(PUSH_PORT, resolve));
const waitFor = async (from, pred, ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const hit = received.slice(from).find(pred);
    if (hit) return hit;
    await sleep(250);
  }
  return null;
};
const isDaily = (p) => p.payload?.kind === 'daily_summary';

// ---------------------------------------------------------------- client
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
}
const login = async (u, p) => {
  const c = new Client();
  await c.req('GET', '/config');
  const r = await c.req('POST', '/auth/login', { usernameOrEmail: u, password: p });
  if (r.status !== 200) throw new Error(`login ${u}: ${r.status}`);
  return c;
};
const admin = await login('admin', 'admin');
const user = await login('user', 'user');
const subscription = { endpoint: `http://localhost:${PUSH_PORT}/daily-device`, keys: { p256dh: device.getPublicKey().toString('base64url'), auth: authSecret.toString('base64url') } };

// ---------------------------------------------------------------- the setting
let r = await user.req('GET', '/push/daily-summary');
check('off at 7:00 by default', r.status === 200 && r.json.enabled === false && r.json.hour === 7, JSON.stringify(r.json));
r = await user.req('PUT', '/push/daily-summary', { enabled: true, hour: 24 });
check('an hour outside 0-23 is refused', r.status === 400, r.json?.error);
r = await user.req('PUT', '/push/daily-summary', { enabled: true, hour: 6.5 });
check('a fractional hour is refused', r.status === 400, r.json?.error);

// The dev university points at the fake Canvas, and the student connects it and one device.
r = await admin.req('GET', '/admin/institutions');
const inst = r.json.find((i) => i.slug === 'dev-university');
await admin.req('PUT', `/admin/institutions/${inst.id}`, { ...inst, canvas_base_url: CANVAS });
r = await user.req('PUT', '/connections/canvas', { token: TOKEN });
check('Canvas connected', r.status === 200, r.json?.error);
await user.req('POST', '/push/subscriptions', { subscription, kinds: ['broadcast'] });
r = await user.req('GET', '/push/daily-summary');
check('the setting knows about the device and Canvas', r.json.devices >= 1 && r.json.canvas_connected === true, JSON.stringify(r.json));

// ---------------------------------------------------------------- send one now
let mark = received.length;
r = await user.req('POST', '/push/daily-summary/preview');
let push = await waitFor(mark, isDaily, 15_000);
check('the preview is sent even to a device that only picked announcements', r.status === 200 && r.json.nothing_due === false && r.json.sent >= 1 && Boolean(push), JSON.stringify(r.json));
check('it lists what is due soon, opens Courses', /Chapter 4 Homework/.test(push?.payload?.body ?? '') && push?.payload?.url === '/courses', JSON.stringify(push?.payload));
check('it leaves out overdue and submitted work', !/Late reflection|Chapter 3 Homework/.test(push?.payload?.body ?? ''), push?.payload?.body);
check('the title counts today and tomorrow', /^Due today: \d+ · Tomorrow: \d+$/.test(push?.payload?.title ?? ''), push?.payload?.title);

// ---------------------------------------------------------------- the morning push from the leader task
const me = (await user.req('GET', '/auth/me')).json.user;
await user.req('PATCH', '/auth/profile', { timezone: 'UTC' });
const utcHour = new Date().getUTCHours();
mark = received.length;
r = await user.req('PUT', '/push/daily-summary', { enabled: true, hour: utcHour });
check('turned on at the current hour', r.status === 200 && r.json.enabled === true && r.json.hour === utcHour, JSON.stringify(r.json));
push = await waitFor(mark, isDaily, 75_000);
check('the leader task sends it once the hour comes', Boolean(push), `${received.length - mark} pushes`);
check('the scheduled one is tagged with the local date', push?.payload?.tag === `daily-${new Date().toISOString().slice(0, 10)}`, push?.payload?.tag);

// Off and on again, and another tick: still once a day.
await user.req('PUT', '/push/daily-summary', { enabled: false, hour: utcHour });
await user.req('PUT', '/push/daily-summary', { enabled: true, hour: utcHour });
mark = received.length;
await sleep(70_000);
check('not sent twice the same day', !received.slice(mark).some(isDaily), `${received.slice(mark).filter(isDaily).length} more`);

// ---------------------------------------------------------------- cleanup
await user.req('PUT', '/push/daily-summary', { enabled: false, hour: 7 });
await user.req('PATCH', '/auth/profile', { timezone: me.timezone });
await user.req('POST', '/push/unsubscribe', { endpoint: subscription.endpoint });
r = await user.req('GET', '/push/daily-summary');
check('back off', r.json.enabled === false, JSON.stringify(r.json));

server.close();
console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
