// Phase 5 web push end-to-end: a fake push service (this script) plays the browser's vendor, decrypts what
// StudyHawk sends (RFC 8291) and checks the VAPID signature. Needs a dev backend on E2E_A (development allows
// local endpoints) and fake-llm.mjs on 4999.
import { createDecipheriv, createECDH, createHmac, createPublicKey, randomBytes, verify } from 'node:crypto';
import http from 'node:http';

const A = process.env.E2E_A ?? 'http://localhost:4000/api';
const LLM = process.env.E2E_LLM ?? 'http://localhost:4999/v1';
const PUSH_PORT = 4996;
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
let vapidKey = null;

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

function vapidValid(header, endpointOrigin) {
  const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header ?? '');
  if (!m || m[4] !== vapidKey) return false;
  const claims = JSON.parse(Buffer.from(m[2], 'base64url').toString());
  const pub = Buffer.from(vapidKey, 'base64url');
  const key = createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') } });
  return claims.aud === endpointOrigin && verify('sha256', Buffer.from(`${m[1]}.${m[2]}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(m[3], 'base64url'));
}

const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  // /gone/... plays a device that uninstalled the app.
  if (req.url.startsWith('/gone/')) {
    res.writeHead(410).end();
    return;
  }
  try {
    received.push({ path: req.url, vapid: vapidValid(req.headers.authorization, `http://localhost:${PUSH_PORT}`), urgency: req.headers.urgency, payload: decrypt(Buffer.concat(chunks)) });
    res.writeHead(201).end();
  } catch (err) {
    received.push({ path: req.url, error: err.message });
    res.writeHead(400).end();
  }
});
await new Promise((resolve) => server.listen(PUSH_PORT, resolve));
const waitFor = async (pred, ms = 15_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const hit = received.find(pred);
    if (hit) return hit;
    await sleep(200);
  }
  return null;
};

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
  async stream(chatId, jobId) {
    const res = await fetch(`${A}/chats/${chatId}/stream?job=${jobId}`, { headers: this.headers('GET') });
    let buffer = '';
    for await (const chunk of res.body) {
      buffer += new TextDecoder().decode(chunk);
      if (/"type":"(done|error)"/.test(buffer)) return;
    }
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
const subscription = (path) => ({
  endpoint: `http://localhost:${PUSH_PORT}${path}`,
  keys: { p256dh: device.getPublicKey().toString('base64url'), auth: authSecret.toString('base64url') },
});

let r = await admin.req('POST', '/admin/models/endpoints', { kind: 'openai_compat', name: 'Fake GPU', base_url: LLM });
r = await admin.req('POST', `/admin/models/endpoints/${r.json.id}/discover`);
for (const m of r.json.models) await admin.req('PATCH', `/admin/models/${m.id}`, { enabled: true, tags: ['smart', 'fast'], supports_tools: true });
await admin.req('PATCH', '/admin/settings', { studyhawk_daily_messages: 0 });

// ---------------------------------------------------------------- keys and subscribing
r = await user.req('GET', '/config');
vapidKey = r.json.vapidPublicKey;
check('the app gets a VAPID public key', Buffer.from(vapidKey ?? '', 'base64url').length === 65, vapidKey);
r = await user.req('POST', '/push/subscriptions', { subscription: { endpoint: 'not a url', keys: { p256dh: 'x', auth: 'y' } }, kinds: ['job_done'] });
check('a broken subscription is refused', r.status === 400, r.json?.error);
r = await user.req('POST', '/push/subscriptions', { subscription: subscription('/device-1'), kinds: ['job_done', 'broadcast'] });
check('device subscribes', r.status === 204);

// ---------------------------------------------------------------- test push
r = await user.req('POST', '/push/test');
let push = await waitFor((p) => p.payload?.tag === 'test');
check('Settings test reaches the device, decrypts, and is signed with our VAPID key', push?.vapid === true && /notifications/i.test(push?.payload?.title ?? ''), JSON.stringify(push));

// ---------------------------------------------------------------- finished turn: push only when nobody watches
const chat = (await user.req('POST', '/chats', {})).json;
r = await user.req('POST', `/chats/${chat.id}/messages`, { content: 'hola desde el telefono', model_ref: 'auto' });
push = await waitFor((p) => p.payload?.kind === 'job_done');
check('a turn finished with the app closed is pushed', push?.payload?.body === 'echo: hola desde el telefono' && push.payload.url === `/chat/${chat.id}`, JSON.stringify(push?.payload));
// The chat's title at that moment: the first message, or the quick model's name for it if that came first.
check('the push carries the chat title', ['hola desde el telefono', 'Chat about hola'].includes(push?.payload?.title), push?.payload?.title);
const before = received.length;
r = await user.req('POST', `/chats/${chat.id}/messages`, { content: 'otra con el chat abierto', model_ref: 'auto' });
await user.stream(chat.id, r.json.job_id);
await sleep(1500);
check('no push while the chat is open', !received.slice(before).some((p) => p.payload?.kind === 'job_done'), JSON.stringify(received.slice(before).map((p) => p.payload?.kind)));

// ---------------------------------------------------------------- kinds the device did not pick
await user.req('POST', '/push/subscriptions', { subscription: subscription('/device-1'), kinds: ['broadcast'] });
const mark = received.length;
r = await user.req('POST', `/chats/${chat.id}/messages`, { content: 'sin aviso', model_ref: 'auto' });
await sleep(4000);
check('a device that turned job_done off gets nothing', !received.slice(mark).some((p) => p.payload?.kind === 'job_done'));

// ---------------------------------------------------------------- uninstalled device
await user.req('POST', '/push/subscriptions', { subscription: subscription('/gone/device-2'), kinds: ['broadcast'] });
r = await admin.req('GET', '/admin/push');
const withGone = r.json.subscriptions;

// ---------------------------------------------------------------- admin: contact, broadcast, banner, new keys
r = await admin.req('PUT', '/admin/push', { contact_email: 'not-an-email' });
check('invalid contact email refused', r.status === 400);
r = await admin.req('PUT', '/admin/push', { contact_email: 'it@uni.example' });
check('contact email saved', r.json?.contact_email === 'it@uni.example');
r = await admin.req('POST', '/admin/push/broadcast', { title: 'Mantenimiento', body: 'StudyHawk se reinicia a las 2 am', url: 'javascript:alert(1)', institution_id: null });
check('a javascript: link is refused', r.status === 400);
r = await admin.req('POST', '/admin/push/broadcast', { title: 'Mantenimiento', body: 'StudyHawk se reinicia a las 2 am', url: '/chat', institution_id: null });
push = await waitFor((p) => p.payload?.kind === 'broadcast');
check('broadcast reaches the device', r.json?.sent === 1 && push?.payload?.title === 'Mantenimiento', JSON.stringify(r.json));
r = await admin.req('GET', '/admin/push');
check('a device that is gone (410) is removed', r.json.subscriptions === withGone - 1, `${withGone} -> ${r.json.subscriptions}`);
r = await user.req('GET', '/config');
check('the app shows it as a banner', r.json.broadcast?.title === 'Mantenimiento', JSON.stringify(r.json.broadcast));
r = await user.req('POST', '/push/subscriptions', { subscription: subscription('/device-1'), kinds: ['job_done'] });
r = await user.req('GET', '/admin/push');
check('students cannot open Admin → Push', r.status === 403);
r = await admin.req('POST', '/admin/push/vapid');
check('new VAPID keys drop the old subscriptions', r.json?.vapid_public_key !== vapidKey && r.json?.subscriptions === 0, JSON.stringify(r.json));

server.close();
console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
