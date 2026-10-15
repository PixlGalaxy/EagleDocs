// Phase 6 end-to-end: plans (tiers) and Stripe billing. The script runs a fake Stripe API on port 4995 and sends
// signed webhooks like Stripe does. Start the backend with STRIPE_API_BASE=http://localhost:4995, fake-llm.mjs on 4999,
// and Docker with the sandbox image (one check starts a sandbox to see the plan's memory).
import { createHmac } from 'node:crypto';
import http from 'node:http';

const A = process.env.E2E_A ?? 'http://localhost:4000/api';
const LLM = process.env.E2E_LLM ?? 'http://localhost:4999/v1';
const STRIPE_PORT = 4995;
const WEBHOOK_SECRET = 'whsec_e2eTestSecret123456';
let failures = 0;
const check = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ` (${extra})` : ''}`);
  if (!cond) failures++;
};

// ---------------------------------------------------------------- fake Stripe
const stripeCalls = [];
const stripe = http.createServer(async (req, res) => {
  let body = '';
  for await (const c of req) body += c;
  const params = Object.fromEntries(new URLSearchParams(body));
  stripeCalls.push({ path: req.url, params, auth: req.headers.authorization });
  res.setHeader('content-type', 'application/json');
  if (req.url === '/v1/customers') return res.end(JSON.stringify({ id: 'cus_e2e1' }));
  if (req.url === '/v1/checkout/sessions') return res.end(JSON.stringify({ id: 'cs_e2e1', url: 'https://checkout.stripe.test/cs_e2e1' }));
  if (req.url === '/v1/billing_portal/sessions') return res.end(JSON.stringify({ url: 'https://billing.stripe.test/p/e2e' }));
  res.statusCode = 404;
  res.end(JSON.stringify({ error: { message: 'unknown endpoint' } }));
});
await new Promise((resolve) => stripe.listen(STRIPE_PORT, resolve));

let eventSeq = 0;
async function webhook(type, object, { secret = WEBHOOK_SECRET, id } = {}) {
  const body = JSON.stringify({ id: id ?? `evt_e2e_${++eventSeq}`, type, data: { object } });
  const t = Math.floor(Date.now() / 1000);
  const sig = `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
  const res = await fetch(`${A}/billing/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': sig }, body });
  return { status: res.status, json: await res.json().catch(() => null) };
}

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
  async ask(content) {
    const chat = (await this.req('POST', '/chats', {})).json;
    const sent = await this.req('POST', `/chats/${chat.id}/messages`, { content, model_ref: 'auto' });
    const res = await fetch(`${A}/chats/${chat.id}/stream?job=${sent.json.job_id}`, { headers: this.headers('GET') });
    let buffer = '';
    for await (const chunk of res.body) {
      buffer += new TextDecoder().decode(chunk);
      const m = /data: (\{"type":"(?:done|error)".*\})\n/.exec(buffer);
      if (m) return JSON.parse(m[1]);
    }
    return null;
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

let r = await admin.req('POST', '/admin/models/endpoints', { kind: 'openai_compat', name: 'Fake GPU', base_url: LLM });
r = await admin.req('POST', `/admin/models/endpoints/${r.json.id}/discover`);
for (const m of r.json.models) await admin.req('PATCH', `/admin/models/${m.id}`, { enabled: true, tags: ['smart', 'fast'], supports_tools: true });

const tiers = (await admin.req('GET', '/admin/tiers')).json;
const free = tiers.find((t) => t.is_default);
const plus = tiers.find((t) => t.name === 'Plus');
check('plans are seeded: Free by default, Plus and Pro off', free?.name === 'Free' && plus && !plus.enabled, tiers.map((t) => `${t.name}${t.enabled ? '' : '(off)'}`).join(','));
const userRow = (await admin.req('GET', '/admin/users?q=user')).json.find((u) => u.username === 'user');

// ---------------------------------------------------------------- billing off: manual plans and their limits
r = await user.req('GET', '/config');
check('billing off: the app shows nothing about payments', r.json.billingEnabled === false);
r = await user.req('POST', '/billing/checkout', { tierId: plus.id });
check('billing off: checkout is not available', r.status === 404, String(r.status));
await admin.req('PUT', `/admin/tiers/${free.id}`, { daily_messages: 1, max_schedules: 1 });
let answer = await user.ask('first message');
answer = await user.ask('second message');
check('Free allows its daily messages, then stops', answer?.type === 'error' && /today/i.test(answer.error ?? ''), answer?.error);
r = await user.req('POST', '/schedules', { name: 'One', cron: '0 8 * * 1', prompt: 'x' });
r = await user.req('POST', '/schedules', { name: 'Two', cron: '0 9 * * 1', prompt: 'x' });
check("Free's schedule limit applies", r.status === 400, String(r.status));

await admin.req('PUT', `/admin/tiers/${plus.id}`, { enabled: true });
r = await admin.req('PATCH', `/admin/users/${userRow.id}`, { tier_id: plus.id });
check('admin gives the student Plus by hand', r.status === 200, JSON.stringify(r.json)?.slice(0, 120));
r = await user.req('GET', '/billing/plan');
check('the student sees Plus and today\'s usage', r.json.tier?.name === 'Plus' && r.json.billing_enabled === false && r.json.usage_today.messages >= 1, JSON.stringify(r.json));
answer = await user.ask('third message on Plus');
check("Plus's daily messages apply right away", answer?.type === 'done', answer?.error);
r = await user.req('POST', '/schedules', { name: 'Two', cron: '0 9 * * 1', prompt: 'x' });
check("Plus's schedule limit applies", r.status === 201, String(r.status));
answer = await user.ask('[py] print("hello from Plus")');
r = await admin.req('GET', '/admin/sandboxes');
const box = r.json.find((s) => s.username === 'user');
check('the next sandbox starts with the plan\'s memory', box?.mem_limit_mb === plus.mem_mb, `${box?.mem_limit_mb} vs ${plus.mem_mb}`);
await admin.req('POST', `/admin/sandboxes/${userRow.id}/stop`);
r = await admin.req('PATCH', `/admin/users/${userRow.id}`, { tier_id: plus.id, tier_expires_at: new Date(Date.now() - 60_000).toISOString() });
r = await user.req('GET', '/billing/plan');
check('an expired manual plan falls back to Free', r.json.tier?.name === 'Free', r.json.tier?.name);
r = await admin.req('PATCH', `/admin/users/${userRow.id}`, { tier_id: '00000000-0000-0000-0000-000000000000' });
check('a plan that does not exist is refused', r.status === 400, String(r.status));
await admin.req('PATCH', `/admin/users/${userRow.id}`, { tier_id: null, tier_expires_at: null });
r = await admin.req('DELETE', `/admin/tiers/${free.id}`);
check('the default plan cannot be deleted', r.status === 409, String(r.status));

// ---------------------------------------------------------------- turning billing on
r = await admin.req('PUT', '/admin/billing', { enabled: true });
check('billing needs both Stripe keys first', r.status === 400, r.json?.error);
r = await admin.req('PUT', '/admin/billing', { stripe_secret_key: 'not-a-key' });
check('a wrong key format is refused', r.status === 400);
r = await admin.req('PUT', '/admin/billing', { stripe_secret_key: 'sk_test_e2eFakeKey1234567890', stripe_webhook_secret: WEBHOOK_SECRET, grace_days: 3, enabled: true });
check('billing turns on, keys are never returned', r.status === 200 && r.json.enabled && r.json.stripe_secret_set && !JSON.stringify(r.json).includes('sk_test_e2e'), JSON.stringify(r.json));
await admin.req('PUT', `/admin/tiers/${plus.id}`, { stripe_price_id: 'price_PlusE2E123' });
r = await user.req('GET', '/billing/tiers');
check('the student can pick Plus', r.json.some((t) => t.id === plus.id), r.json.map((t) => t.name).join(','));

// ---------------------------------------------------------------- checkout → webhook → plan
r = await user.req('POST', '/billing/checkout', { tierId: plus.id });
const session = stripeCalls.find((c) => c.path === '/v1/checkout/sessions')?.params ?? {};
check('checkout opens a Stripe subscription for Plus', r.json?.url === 'https://checkout.stripe.test/cs_e2e1' && session.mode === 'subscription' && session['line_items[0][price]'] === 'price_PlusE2E123' && session.client_reference_id === userRow.id, JSON.stringify(session).slice(0, 200));
check('Stripe is called with the secret key', stripeCalls[0]?.auth === 'Bearer sk_test_e2eFakeKey1234567890');
r = await webhook('checkout.session.completed', { client_reference_id: userRow.id, customer: 'cus_e2e1', subscription: 'sub_e2e1', metadata: { tier_id: plus.id } }, { secret: 'whsec_wrongSecret12345' });
check('an unsigned webhook is refused', r.status === 400);
r = await webhook('checkout.session.completed', { client_reference_id: userRow.id, customer: 'cus_e2e1', subscription: 'sub_e2e1', metadata: { tier_id: plus.id } }, { id: 'evt_checkout' });
check('the checkout webhook is processed', r.json?.outcome === 'processed', JSON.stringify(r.json));
r = await user.req('GET', '/billing/plan');
check('the plan changes to Plus', r.json.tier?.name === 'Plus' && r.json.subscription_status === 'active', JSON.stringify(r.json).slice(0, 160));
r = await webhook('checkout.session.completed', { client_reference_id: userRow.id }, { id: 'evt_checkout' });
check('the same event twice is processed once', r.json?.outcome === 'duplicate');
r = await user.req('POST', '/billing/checkout', { tierId: plus.id });
check('a second checkout points to the portal instead', r.status === 409, r.json?.error);
r = await user.req('POST', '/billing/portal');
check('the portal opens for the customer', r.json?.url === 'https://billing.stripe.test/p/e2e' && stripeCalls.at(-1)?.params.customer === 'cus_e2e1');

// ---------------------------------------------------------------- failed payment, cancel, end of period
const end = Math.floor(Date.now() / 1000) + 20 * 86400;
r = await webhook('invoice.payment_failed', { customer: 'cus_e2e1' });
r = await user.req('GET', '/billing/plan');
check('a failed payment keeps the plan during the grace period', r.json.tier?.name === 'Plus' && r.json.grace_until, JSON.stringify(r.json).slice(0, 200));
await webhook('invoice.paid', { customer: 'cus_e2e1' });
await webhook('customer.subscription.updated', { id: 'sub_e2e1', customer: 'cus_e2e1', status: 'active', cancel_at_period_end: true, current_period_end: end, items: { data: [{ price: { id: 'price_PlusE2E123' } }] } });
r = await user.req('GET', '/billing/plan');
check('cancelling in the portal keeps Plus until the period ends', r.json.tier?.name === 'Plus' && r.json.cancel_at_period_end && !r.json.grace_until && r.json.current_period_end, JSON.stringify(r.json).slice(0, 200));
await webhook('customer.subscription.deleted', { id: 'sub_e2e1', customer: 'cus_e2e1', status: 'canceled', items: { data: [{ price: { id: 'price_PlusE2E123' } }] } });
r = await user.req('GET', '/billing/plan');
check('at the end of the period the student is back on Free', r.json.tier?.name === 'Free' && r.json.subscription_status === 'canceled', JSON.stringify(r.json).slice(0, 160));

await admin.req('PUT', `/admin/tiers/${free.id}`, { daily_messages: 100, max_schedules: 3 });
await admin.req('PUT', '/admin/billing', { enabled: false });
stripe.close();
console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
