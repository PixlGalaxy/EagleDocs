// Phase 4 acceptance on sandboxes and replicas: isolation between users, the memory limit, the per-node queue,
// moving a sandbox to another replica (files and the Outlook session survive) and a replica dying mid-job.
// Starts its own replicas A and B (one job worker each) on a shared database and data root:
//   E2E_DATABASE_URL  Postgres both replicas use (fresh, e.g. docker run postgres:17-alpine)
//   E2E_DATA_ROOT     shared data root (fresh folder)
// Needs Docker with studyhawk-sandbox:dev, fake-llm.mjs on 4999 and fake-school.mjs on 4997.
import { spawn } from 'child_process';
import { once } from 'events';

const LLM = process.env.E2E_LLM ?? 'http://localhost:4999/v1';
const SCHOOL_HOST = process.env.E2E_SCHOOL ?? 'http://localhost:4997';
const SCHOOL = process.env.E2E_SCHOOL_FROM_SANDBOX ?? 'http://host.docker.internal:4997';
const PORT_A = 4101;
const PORT_B = 4102;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let failures = 0;
const check = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ` (${extra})` : ''}`);
  if (!cond) failures++;
};

/** One replica, in this process's tree so the test can kill it like a crashed server. */
async function replica(name, port) {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    env: {
      ...process.env,
      DATABASE_URL: process.env.E2E_DATABASE_URL,
      DATA_ROOT: process.env.E2E_DATA_ROOT,
      PORT: String(port),
      NODE_ID: name,
      JOB_WORKERS: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 120 && !/listening/.test(log); i++) {
    if (child.exitCode !== null) break;
    await sleep(1000);
  }
  if (!/listening/.test(log)) throw new Error(`${name} did not start:\n${log.slice(-2000)}`);
  return { child, base: `http://localhost:${port}/api`, log: () => log };
}

class Client {
  jar = {};
  constructor(base) {
    this.base = base;
  }
  headers(method, body) {
    const h = { cookie: Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join('; ') };
    if (body !== undefined) h['content-type'] = 'application/json';
    if (this.jar.csrf && method !== 'GET') h['x-csrf-token'] = decodeURIComponent(this.jar.csrf);
    return h;
  }
  async req(method, path, body) {
    const res = await fetch(this.base + path, { method, headers: this.headers(method, body), body: body === undefined ? undefined : JSON.stringify(body) });
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
  send(chatId, content) {
    return this.req('POST', `/chats/${chatId}/messages`, { content, model_ref: 'auto' });
  }
  async stream(chatId, jobId, onEvent = async () => {}) {
    const res = await fetch(`${this.base}/chats/${chatId}/stream?job=${jobId}`, { headers: this.headers('GET') });
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
  async ask(chatId, content, onEvent) {
    const sent = await this.send(chatId, content);
    return this.stream(chatId, sent.json.job_id, onEvent);
  }
  /** Same session, other replica (sessions live in the shared database). */
  on(base) {
    const other = new Client(base);
    other.jar = this.jar;
    return other;
  }
}
const login = async (base, u, p) => {
  const c = new Client(base);
  await c.req('GET', '/config');
  const r = await c.req('POST', '/auth/login', { usernameOrEmail: u, password: p });
  if (r.status !== 200) throw new Error(`login ${u}: ${r.status}`);
  return c;
};
const result = (events, name) => events.filter((e) => e.type === 'tool_result' && e.call.name === name).at(-1)?.call;
const py = (code) => `[py] ${code}`;

const A = await replica('node-a', PORT_A);
try {
  const admin = await login(A.base, 'admin', 'admin');
  const user = await login(A.base, 'user', 'user');

  let r = await admin.req('POST', '/admin/models/endpoints', { kind: 'openai_compat', name: 'Fake GPU', base_url: LLM });
  r = await admin.req('POST', `/admin/models/endpoints/${r.json.id}/discover`);
  for (const m of r.json.models) await admin.req('PATCH', `/admin/models/${m.id}`, { enabled: true, tags: ['smart', 'fast'], supports_tools: true });
  await admin.req('PATCH', '/admin/settings', { studyhawk_daily_messages: 0 });
  const inst = (await admin.req('GET', '/admin/institutions')).json.find((i) => i.slug === 'dev-university');
  await admin.req('PUT', `/admin/institutions/${inst.id}`, { ...inst, outlook_url: `${SCHOOL}/mail/`, degreeworks_url: `${SCHOOL}/dw/` });
  const sandboxSettings = (await admin.req('GET', '/admin/sandbox')).json;
  r = await admin.req('PUT', '/admin/sandbox', { ...sandboxSettings, max_active_per_node: 4 });
  // The memory a sandbox gets comes from the student's plan (phase 6), not from the sandbox settings.
  const freePlan = (await admin.req('GET', '/admin/tiers')).json.find((t) => t.is_default);
  const plan = await admin.req('PUT', `/admin/tiers/${freePlan.id}`, { mem_mb: 512 });
  check('sandbox memory set to 512 MB', r.status === 200 && plan.status === 200, JSON.stringify(plan.json).slice(0, 160));

  const userChat = (await user.req('POST', '/chats', {})).json.id;
  const adminChat = (await admin.req('POST', '/chats', {})).json.id;

  // ---------------------------------------------------------------- isolation and memory limit
  let events = await user.ask(userChat, py("open('only-mine.txt','w').write('secret of user'); print('written')"));
  check('user writes a file in their sandbox', /written/.test(result(events, 'code_run')?.result_preview ?? ''), result(events, 'code_run')?.result_preview);
  events = await admin.ask(
    adminChat,
    py("import os; print(sorted(os.listdir('/workspace'))); print([p for p in ('/workspace/only-mine.txt', '/workspace/../only-mine.txt') if os.path.exists(p)])"),
  );
  const adminView = result(events, 'code_run')?.result_preview ?? '';
  check('another user cannot see it', /\[\]/.test(adminView) && !/only-mine/.test(adminView.replace(/'\/workspace[^']*'/g, '')), adminView);
  events = await user.ask(userChat, py("b = bytearray(900 * 1024 * 1024); b[::4096] = b'x' * len(b[::4096]); print('survived')"));
  const oom = result(events, 'code_run')?.result_preview ?? '';
  check('the 512 MB limit kills a process that goes over', !/survived/.test(oom) && /137|kill|memory/i.test(oom), oom.slice(0, 200));
  events = await user.ask(userChat, py("print(open('only-mine.txt').read())"));
  check('the sandbox keeps working after the kill', /secret of user/.test(result(events, 'code_run')?.result_preview ?? ''), result(events, 'code_run')?.result_preview);

  // ---------------------------------------------------------------- one sandbox per node: the second user waits
  for (const s of (await admin.req('GET', '/admin/sandboxes')).json) await admin.req('POST', `/admin/sandboxes/${s.user_id}/stop`);
  await admin.req('PUT', '/admin/sandbox', { ...sandboxSettings, default_mem_mb: 512, max_active_per_node: 1 });
  await sleep(500);
  await user.ask(userChat, py("print('user first')"));
  const waitStart = Date.now();
  events = await admin.ask(adminChat, py("print('admin second')"));
  const waited = Math.round((Date.now() - waitStart) / 1000);
  check('second user waits for the slot, then runs', /admin second/.test(result(events, 'code_run')?.result_preview ?? '') && waited >= 20, `${waited}s`);
  r = await admin.req('GET', '/admin/sandboxes');
  check('only one sandbox active on the node', r.json.length === 1, JSON.stringify(r.json.map((s) => s.username ?? s.user_id)));
  await admin.req('PUT', '/admin/sandbox', { ...sandboxSettings, default_mem_mb: 512, max_active_per_node: 4 });

  // ---------------------------------------------------------------- Outlook session on A
  await user.req('PUT', '/connections/sso', { email: 'dev.student@uni.example', password: 'correct-horse' });
  events = await user.ask(userChat, '[inbox]', async (e) => {
    if (e.type === 'mfa_required') await fetch(`${SCHOOL_HOST}/__approve`, { method: 'POST' });
  });
  check('signed in to Outlook on A (with Duo)', result(events, 'email_inbox')?.status === 'done', result(events, 'email_inbox')?.result_preview);
  r = await admin.req('GET', '/admin/sandboxes');
  check('the user sandbox runs on A', Boolean(r.json.find((s) => s.username === 'user' && s.node_id === 'node-a')), JSON.stringify(r.json));

  // ---------------------------------------------------------------- A busy: the next job runs on B and takes the sandbox
  const busy = await admin.send(adminChat, 'keep A busy [slow] [veryslow]');
  await sleep(2000);
  const B = await replica('node-b', PORT_B);
  try {
    const userB = user.on(B.base);
    const adminB = admin.on(B.base);
    let mfa = false;
    events = await userB.ask(userChat, '[inbox]', async (e) => {
      if (e.type === 'mfa_required') mfa = true;
    });
    r = await adminB.req('GET', '/admin/sandboxes');
    const moved = r.json.find((s) => s.username === 'user' && s.node_id === 'node-b');
    check('the job ran on B and the sandbox moved there', Boolean(moved), JSON.stringify(r.json));
    check('Outlook session kept: no new Duo', result(events, 'email_inbox')?.status === 'done' && !mfa, result(events, 'email_inbox')?.result_preview);
    events = await userB.ask(userChat, py("print(open('only-mine.txt').read())"));
    check('files kept after the move', /secret of user/.test(result(events, 'code_run')?.result_preview ?? ''), result(events, 'code_run')?.result_preview);

    // ---------------------------------------------------------------- A dies with a job running
    A.child.kill();
    const killedAt = Date.now();
    let status = 'running';
    while (status !== 'interrupted' && Date.now() - killedAt < 120_000) {
      await sleep(2000);
      status = (await adminB.req('GET', '/jobs')).json.find((j) => j.id === busy.json.job_id)?.status;
    }
    const seconds = Math.round((Date.now() - killedAt) / 1000);
    check('a job on a dead replica is interrupted in under 60 s', status === 'interrupted' && seconds < 60, `${status} after ${seconds}s`);
    events = await adminB.stream(adminChat, busy.json.job_id);
    check('the student is told to send it again', /send your message again/i.test(events.at(-1)?.error ?? ''), events.at(-1)?.error);
    events = await adminB.ask(adminChat, 'retry on B');
    check('retrying works on B', events.at(-1)?.type === 'done', events.at(-1)?.error);
  } finally {
    B.child.kill();
  }
} finally {
  if (A.child.exitCode === null) A.child.kill();
  await Promise.race([once(A.child, 'exit'), sleep(3000)]);
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
