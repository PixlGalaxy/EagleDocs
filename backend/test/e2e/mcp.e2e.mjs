// Phase 7 end-to-end: EagleDocs as an MCP app. The script plays an MCP client (what ChatGPT or Claude do): discovery,
// dynamic registration, authorize with PKCE, the student's consent, token exchange and rotation, MCP calls, revocation.
// Needs a dev backend on E2E_A (E2E_ORIGIN is its public origin, the PUBLIC_URL the backend was started with).
import { createHash, randomBytes } from 'node:crypto';

const A = process.env.E2E_A ?? 'http://localhost:4000/api';
const ORIGIN = process.env.E2E_ORIGIN ?? A.replace(/\/api$/, '');
const REDIRECT = 'http://localhost:4994/callback';
let failures = 0;
const check = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ` (${extra})` : ''}`);
  if (!cond) failures++;
};

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
const json = async (res) => ({ status: res.status, headers: res.headers, body: await res.json().catch(() => null) });
const form = (data) => new URLSearchParams(data).toString();
let rpcId = 0;
const rpc = async (token, method, params = {}, notification = false) =>
  json(
    await fetch(`${ORIGIN}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(token && { authorization: `Bearer ${token}` }) },
      body: JSON.stringify({ jsonrpc: '2.0', method, params, ...(notification ? {} : { id: ++rpcId }) }),
    }),
  );

// ---------------------------------------------------------------- off by default
let res = await json(await fetch(`${ORIGIN}/.well-known/oauth-authorization-server`));
check('MCP is off until the admin turns it on', res.status === 404, String(res.status));
await admin.req('PATCH', '/admin/settings', { mcp_enabled: true });

// ---------------------------------------------------------------- discovery and registration
res = await rpc(null, 'initialize', {});
check('an MCP call without a token gets 401 and where to log in', res.status === 401 && /resource_metadata=".*\/.well-known\/oauth-protected-resource"/.test(res.headers.get('www-authenticate') ?? ''), res.headers.get('www-authenticate'));
res = await json(await fetch(`${ORIGIN}/.well-known/oauth-protected-resource`));
const resource = res.body;
check('protected resource metadata', resource?.resource === `${ORIGIN}/mcp` && resource.authorization_servers?.[0] === ORIGIN, JSON.stringify(resource));
res = await json(await fetch(`${ORIGIN}/.well-known/oauth-authorization-server`));
const meta = res.body;
check('authorization server metadata (PKCE S256, registration)', meta?.code_challenge_methods_supported?.includes('S256') && meta.registration_endpoint === `${ORIGIN}/oauth/register`, JSON.stringify(meta)?.slice(0, 160));
res = await json(await fetch(meta.registration_endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Test Assistant', redirect_uris: ['http://evil.example/cb'] }) }));
check('a non-https redirect URI is refused', res.status === 400 && res.body?.error === 'invalid_redirect_uri');
res = await json(await fetch(meta.registration_endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Test Assistant', redirect_uris: [REDIRECT] }) }));
const clientId = res.body?.client_id;
check('dynamic client registration (public client)', res.status === 201 && /^mcp_/.test(clientId ?? '') && !res.body.client_secret, JSON.stringify(res.body));

// ---------------------------------------------------------------- authorize with PKCE and the consent screen
const pkce = () => {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};
const authorize = async (scope, { verifier, challenge }) => {
  const url = `${meta.authorization_endpoint}?${form({ response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', scope, state: 'xyz', resource: `${ORIGIN}/mcp` })}`;
  const r = await fetch(url, { redirect: 'manual' });
  return { status: r.status, location: r.headers.get('location') ?? '', verifier };
};
let p = pkce();
let auth = await fetch(`${meta.authorization_endpoint}?${form({ response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, scope: 'memory' })}`, { redirect: 'manual' });
check('authorize without PKCE goes back with an error', auth.status === 302 && /error=invalid_request/.test(auth.headers.get('location') ?? ''), auth.headers.get('location'));
auth = await fetch(`${meta.authorization_endpoint}?${form({ response_type: 'code', client_id: clientId, redirect_uri: 'https://other.example/cb', code_challenge: p.challenge, code_challenge_method: 'S256' })}`, { redirect: 'manual' });
check('an unregistered redirect URI is never redirected to', auth.status === 400, String(auth.status));
let a = await authorize('canvas.read workspace memory', p);
const requestId = new URL(a.location).searchParams.get('request');
check('authorize sends the student to the consent screen', a.status === 302 && a.location.startsWith(`${ORIGIN}/oauth/consent?request=`), a.location);
let r = await user.req('GET', `/oauth/requests/${requestId}`);
check('the consent screen shows the app and what it asks for', r.json?.client_name === 'Test Assistant' && r.json.scopes.join(',') === 'canvas.read,workspace,memory', JSON.stringify(r.json));
// The student unticks "workspace".
r = await user.req('POST', `/oauth/requests/${requestId}`, { approve: true, scopes: ['canvas.read', 'memory'] });
const back = new URL(r.json?.redirect_to ?? 'http://x');
const code = back.searchParams.get('code');
check('approving goes back to the app with a code, the state and the issuer', back.origin + back.pathname === REDIRECT && code && back.searchParams.get('state') === 'xyz' && back.searchParams.get('iss') === ORIGIN, back.toString().slice(0, 120));

// ---------------------------------------------------------------- token exchange
const tokenCall = (data) => fetch(meta.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form(data) }).then(json);
res = await tokenCall({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: pkce().verifier });
check('a wrong PKCE verifier is refused', res.status === 400 && res.body?.error === 'invalid_grant');
res = await tokenCall({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: a.verifier });
let tokens = res.body;
check('code + verifier give an access and a refresh token', res.status === 200 && /^mca_/.test(tokens?.access_token ?? '') && /^mcr_/.test(tokens?.refresh_token ?? '') && tokens.scope === 'canvas.read memory', JSON.stringify(tokens)?.slice(0, 120));
res = await tokenCall({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: a.verifier });
check('a code works only once', res.body?.error === 'invalid_grant');

// ---------------------------------------------------------------- MCP calls
res = await rpc(tokens.access_token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
check('initialize', res.body?.result?.serverInfo?.name === 'EagleDocs' && res.body.result.protocolVersion === '2025-06-18' && res.body.result.capabilities.tools, JSON.stringify(res.body)?.slice(0, 160));
res = await rpc(tokens.access_token, 'notifications/initialized', {}, true);
check('notifications get 202 with no body', res.status === 202);
res = await rpc(tokens.access_token, 'tools/list');
let names = (res.body?.result?.tools ?? []).map((t) => t.name);
check('tools follow the granted scopes', names.includes('canvas_upcoming') && names.includes('memory_read') && names.includes('memory_update') && !names.some((n) => n.startsWith('files_')) && !names.includes('code_run'), names.join(','));
check('the school email and the browser are never offered', !names.some((n) => /^(email_|browser_|cron_)/.test(n)));
const upcoming = res.body.result.tools.find((t) => t.name === 'canvas_upcoming');
check('read-only tools say so', upcoming?.annotations?.readOnlyHint === true && upcoming.inputSchema?.type === 'object');

await user.req('PUT', '/memories/docs/user', { content: 'Studies Accounting\n§\nWorks Tuesday nights' });
res = await rpc(tokens.access_token, 'tools/call', { name: 'memory_read', arguments: {} });
check('a memory saved in the web shows up in the app', /Works Tuesday nights/.test(res.body?.result?.content?.[0]?.text ?? ''), res.body?.result?.content?.[0]?.text?.slice(0, 120));
res = await rpc(tokens.access_token, 'tools/call', { name: 'memory_update', arguments: { target: 'user', action: 'add', content: 'Prefers flashcards for exams' } });
check('the app saves a memory', res.body?.result?.isError === false, res.body?.result?.content?.[0]?.text);
r = await user.req('GET', '/memories');
check('and the web sees it', /Prefers flashcards for exams/.test(r.json?.docs?.user ?? ''), r.json?.docs?.user);
res = await rpc(tokens.access_token, 'tools/call', { name: 'files_list', arguments: { path: '' } });
check('a tool outside the granted scopes cannot be called', res.body?.result?.isError === true, res.body?.result?.content?.[0]?.text);
res = await rpc(tokens.access_token, 'tools/call', { name: 'canvas_upcoming', arguments: {} });
check('a Canvas tool runs (and says Canvas is not connected for this account)', res.body?.result?.content?.[0]?.text?.length > 0, res.body?.result?.content?.[0]?.text?.slice(0, 120));
res = await rpc(tokens.access_token, 'prompts/list');
const prompts = (res.body?.result?.prompts ?? []).map((x) => x.name);
check('skills are offered as prompts', prompts.includes('canvas-lms') && prompts.includes('study-coaching'), prompts.join(','));
res = await rpc(tokens.access_token, 'prompts/get', { name: 'study-coaching' });
check('a prompt carries the skill with the student filled in', /Study Coaching|study/i.test(res.body?.result?.messages?.[0]?.content?.text ?? '') && !/\{\{/.test(res.body?.result?.messages?.[0]?.content?.text ?? ''));
res = await rpc(tokens.access_token, 'resources/read', { uri: 'eagledocs://profile' });
check('the profile resource personalizes from the first message', /Works Tuesday nights/.test(res.body?.result?.contents?.[0]?.text ?? ''), res.body?.result?.contents?.[0]?.text?.slice(0, 120));
res = await rpc(tokens.access_token, 'no/such/method');
check('unknown methods get a JSON-RPC error', res.body?.error?.code === -32601);

// ---------------------------------------------------------------- refresh rotation and reuse detection
res = await tokenCall({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId });
const rotated = res.body;
check('refresh gives new tokens', res.status === 200 && rotated?.access_token && rotated.access_token !== tokens.access_token);
res = await tokenCall({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId });
check('an old refresh token used again is refused', res.body?.error === 'invalid_grant');
res = await rpc(rotated.access_token, 'ping');
check('and that cuts every token of the grant (someone had a copy)', res.status === 401, String(res.status));

// ---------------------------------------------------------------- full scopes, destructive hint, revocation
p = pkce();
a = await authorize('canvas.read workspace memory', p);
r = await user.req('POST', `/oauth/requests/${new URL(a.location).searchParams.get('request')}`, { approve: true, scopes: ['canvas.read', 'workspace', 'memory'] });
res = await tokenCall({ grant_type: 'authorization_code', code: new URL(r.json.redirect_to).searchParams.get('code'), redirect_uri: REDIRECT, client_id: clientId, code_verifier: a.verifier });
tokens = res.body;
res = await rpc(tokens.access_token, 'tools/list');
const del = res.body?.result?.tools?.find((t) => t.name === 'files_delete');
check('with the workspace scope, deleting is offered and marked destructive (clients ask first)', del?.annotations?.destructiveHint === true && del.annotations.readOnlyHint === false, JSON.stringify(del?.annotations));
// The plan's daily allowance for apps.
const freePlan = (await admin.req('GET', '/admin/tiers')).json.find((t) => t.is_default);
check('Free has medium-high app limits', freePlan.mcp_daily_calls === 300 && freePlan.mcp_daily_code_runs === 40, `${freePlan.mcp_daily_calls}/${freePlan.mcp_daily_code_runs}`);
await admin.req('PUT', `/admin/tiers/${freePlan.id}`, { mcp_daily_calls: 1 });
res = await rpc(tokens.access_token, 'tools/call', { name: 'memory_read', arguments: {} });
check('past the daily limit, calls stop with a reason and how to get more', res.body?.result?.isError === true && /calls a day/.test(res.body.result.content[0].text) && /Settings → Plan/.test(res.body.result.content[0].text), res.body?.result?.content?.[0]?.text);
r = await user.req('GET', '/billing/plan');
check("Settings → Plan shows today's app calls", r.json?.usage_today?.mcp_calls > 1, JSON.stringify(r.json?.usage_today));
await admin.req('PUT', `/admin/tiers/${freePlan.id}`, { mcp_daily_calls: 300 });
r = await user.req('GET', '/mcp-apps');
const app = r.json?.apps?.find((x) => x.client_name === 'Test Assistant');
check('Settings → Apps lists the app with its permissions', r.json?.enabled && r.json.server_url === `${ORIGIN}/mcp` && app?.scopes?.length === 3, JSON.stringify(r.json)?.slice(0, 200));
r = await user.req('DELETE', `/mcp-apps/${app?.id}`);
const t0 = Date.now();
res = await rpc(tokens.access_token, 'ping');
check('revoking cuts access at once', r.status === 204 && res.status === 401 && Date.now() - t0 < 5000, `${res.status} in ${Date.now() - t0} ms`);
r = await user.req('GET', '/mcp-apps');
check('and the app is gone from the list', !r.json?.apps?.some((x) => x.id === app?.id));

await admin.req('PATCH', '/admin/settings', { mcp_enabled: false });
res = await rpc(rotated.access_token, 'ping');
check('turning MCP off closes the endpoint', res.status === 404, String(res.status));

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
