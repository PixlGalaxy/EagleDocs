// Phase 4 end-to-end: per-user sandbox (code_run), the browser with its approval policy, Admin → Sandbox and the
// Admin → Users status dot. Needs Docker with the studyhawk-sandbox:dev image (docker build -t studyhawk-sandbox:dev sandbox),
// a dev backend on E2E_A (dev seed accounts), fake-llm.mjs on 4999, and internet (example.com, instructure.com).
const A = process.env.E2E_A ?? 'http://localhost:4000/api';
const LLM = process.env.E2E_LLM ?? 'http://localhost:4999/v1';
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
    return { status: res.status, json, raw: text };
  }
  /** Sends a message and reads its stream to the end; `onEvent` may act mid-stream (approvals). */
  async ask(chatId, content, onEvent = async () => {}) {
    const sent = await this.req('POST', `/chats/${chatId}/messages`, { content, model_ref: 'auto' });
    const res = await fetch(`${A}/chats/${chatId}/stream?job=${sent.json.job_id}`, { headers: this.headers('GET') });
    const events = [];
    let buffer = '';
    for await (const chunk of res.body) {
      buffer += new TextDecoder().decode(chunk);
      let i;
      while ((i = buffer.indexOf('\n\n')) >= 0) {
        const data = buffer.slice(0, i).split('\n').find((l) => l.startsWith('data:'));
        buffer = buffer.slice(i + 2);
        if (!data) continue;
        const event = JSON.parse(data.slice(5));
        events.push(event);
        await onEvent(event);
        if (event.type === 'done' || event.type === 'error') return events;
      }
    }
    return events;
  }
}
const login = async (u, p) => {
  const c = new Client();
  await c.req('GET', '/config');
  const r = await c.req('POST', '/auth/login', { usernameOrEmail: u, password: p });
  if (r.status !== 200) throw new Error(`login ${u}: ${r.status}`);
  return c;
};
const toolResult = (events, name) => events.filter((e) => e.type === 'tool_result' && e.call.name === name).at(-1)?.call;
const dotOf = async (admin, username) => (await admin.req('GET', `/admin/users?q=${username}`)).json.find((u) => u.username === username)?.sandbox_status;

const admin = await login('admin', 'admin');
const user = await login('user', 'user');

// ---------------------------------------------------------------- setup: a model
let r = await admin.req('POST', '/admin/models/endpoints', { kind: 'openai_compat', name: 'Fake GPU', base_url: LLM });
r = await admin.req('POST', `/admin/models/endpoints/${r.json.id}/discover`);
for (const m of r.json.models) await admin.req('PATCH', `/admin/models/${m.id}`, { enabled: true, tags: ['smart', 'fast'], supports_tools: true });
await admin.req('PATCH', '/admin/settings', { studyhawk_daily_messages: 0 });

// ---------------------------------------------------------------- Admin → Sandbox
r = await admin.req('GET', '/admin/sandbox');
check('sandboxes enabled (Docker and image found)', r.status === 200 && r.json.enabled === true, JSON.stringify(r.json));
// Memory per student comes from their plan (Free by default).
const freePlan = (await admin.req('GET', '/admin/tiers')).json.find((t) => t.is_default);
await admin.req('PUT', `/admin/tiers/${freePlan.id}`, { mem_mb: 1024 });
r = await admin.req('PUT', '/admin/sandbox', { ...r.json, idle_timeout_minutes: 10 });
check('admin saves sandbox settings', r.status === 200 && r.json.idle_timeout_minutes === 10);
r = await admin.req('PUT', '/admin/sandbox', { ...r.json, default_mem_mb: 1 });
check('invalid limits refused', r.status === 400);
r = await user.req('GET', '/admin/sandbox');
check('students cannot read sandbox settings', r.status === 403);
const firstDot = await dotOf(admin, 'user');
check('status dot starts red (off)', firstDot === 'off', firstDot);

// ---------------------------------------------------------------- code_run
const chat = (await user.req('POST', '/chats', {})).json;
let sawWorking = false;
const t0 = Date.now();
let events = await user.ask(chat.id, 'run something [code]', async (e) => {
  if (e.type === 'tool_call' && e.call.status === 'running' && !sawWorking) sawWorking = (await dotOf(admin, 'user')) === 'working';
});
const code = toolResult(events, 'code_run');
check('code_run ran in the sandbox', code?.status === 'done' && /"exit_code": 0/.test(code.result_preview) && /"stdout": "42/.test(code.result_preview), code?.result_preview);
check('new files reported', /e2e-out\.txt/.test(code?.result_preview ?? ''));
check('dot is green (working) while the agent runs', sawWorking);
console.log(`   first run with a cold sandbox: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
r = await user.req('GET', '/files');
check('the file is in the student\'s workspace', r.json.entries.some((e) => e.name === 'e2e-out.txt'));
check('no stray TEMP or .browser folder in the listing', r.json.entries.filter((e) => e.name === 'TEMP').length === 1 && !r.json.entries.some((e) => e.name === '.browser'));
check('dot is orange (idle) after the run', (await dotOf(admin, 'user')) === 'idle');

r = await admin.req('GET', '/admin/sandboxes');
const row = r.json.find((s) => s.username === 'user');
check('Admin → Sandbox lists it with live numbers', row && row.status === 'running' && row.mem_limit_mb === 1024 && row.mem_mb > 0, JSON.stringify(row));
r = await admin.req('GET', '/admin/nodes');
check('node shows one active sandbox', r.json.some((n) => n.sandboxes_active === 1));

const t1 = Date.now();
events = await user.ask(chat.id, 'again [code]');
check('second run reuses the warm sandbox', toolResult(events, 'code_run')?.status === 'done' && Date.now() - t1 < 8000, `${Date.now() - t1} ms`);

// ---------------------------------------------------------------- browser
events = await user.ask(chat.id, 'look [browse https://example.com/]');
const open = toolResult(events, 'browser_open');
check('browser opens a real page', open?.status === 'done' && /Example Domain/.test(open.result_preview), open?.result_preview);
const ref = /\[@(e\d+)\]/.exec(open?.result_preview ?? '')?.[1] ?? 'e1';

let approvalSeen = null;
events = await user.ask(chat.id, `[click @${ref}]`, async (e) => {
  if (e.type === 'approval_required') {
    approvalSeen = e.approval;
    await user.req('POST', `/approvals/${e.approval.id}/approve`);
  }
});
check('clicking on an untrusted site asks first', approvalSeen?.summary?.startsWith('Click'), JSON.stringify(approvalSeen));
check('approved click runs', toolResult(events, 'browser_click')?.status === 'done', toolResult(events, 'browser_click')?.result_preview);

r = await user.req('POST', '/browser/trusted', { domain: 'https://www.Example.com/some/page' });
check('trusted domain normalized', r.status === 201 && r.json.domain === 'example.com', JSON.stringify(r.json));
r = await user.req('POST', '/browser/trusted', { domain: 'fgcu.instructure.com' });
check('Canvas cannot be trusted', r.status === 400);
await user.ask(chat.id, 'look [browse https://example.com/]');
approvalSeen = null;
events = await user.ask(chat.id, `[click @${ref}]`, async (e) => {
  if (e.type === 'approval_required') approvalSeen = e.approval;
});
check('trusted site: no approval needed', !approvalSeen && toolResult(events, 'browser_click')?.status === 'done');

// Canvas (any *.instructure.com, and the school's Canvas URL): reading works, acting is blocked.
events = await user.ask(chat.id, 'look [browse https://www.instructure.com/]');
check('the browser can read a Canvas site', toolResult(events, 'browser_open')?.status === 'done', toolResult(events, 'browser_open')?.result_preview);
events = await user.ask(chat.id, '[click @e1]');
const blocked = toolResult(events, 'browser_click');
check('acting on Canvas is blocked', blocked?.status === 'rejected' && /never acts on Canvas/.test(blocked.result_preview), blocked?.result_preview);

r = await user.req('GET', '/browser');
check('cookie profile listed', r.json.available && r.json.profiles.includes('default') && r.json.trusted.some((t) => t.domain === 'example.com'), JSON.stringify(r.json));
r = await user.req('DELETE', '/browser/profiles/default');
check('profile cookies deleted', r.status === 204 && !(await user.req('GET', '/browser')).json.profiles.includes('default'));
r = await user.req('GET', '/files?path=.browser');
check('.browser is not reachable through Files', r.status >= 400);

// ---------------------------------------------------------------- web search and fetch (no sandbox needed)
events = await user.ask(chat.id, '[search FIFO vs LIFO inventory]');
const found = toolResult(events, 'web_search');
check('web_search finds real results', found?.status === 'done' && /"url": "https:\/\//.test(found.result_preview), found?.result_preview);
events = await user.ask(chat.id, '[fetch https://example.com/]');
check('web_fetch reads a page as text', /Example Domain/.test(toolResult(events, 'web_fetch')?.result_preview ?? ''));
events = await user.ask(chat.id, '[fetch http://127.0.0.1:4000/api/admin/overview]');
const ssrf = toolResult(events, 'web_fetch');
check('web_fetch refuses internal addresses', ssrf?.status === 'error' && /not reachable/.test(ssrf.result_preview), ssrf?.result_preview);

// ---------------------------------------------------------------- stop
r = await admin.req('POST', `/admin/sandboxes/${row.user_id}/stop`);
check('admin stops the sandbox', r.status === 204);
check('dot back to red (off)', (await dotOf(admin, 'user')) === 'off');
r = await user.req('GET', '/files');
check('workspace survives the stop', r.json.entries.some((e) => e.name === 'e2e-out.txt'));

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
