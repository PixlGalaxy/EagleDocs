// In-browser fake backend for `npm run dev:mock`: lets the whole UI be clicked
// through (and screenshotted) without the real API. Sign in with any password;
// an identity containing "admin" gets the admin role.
import * as db from './data';
import type { AdminUserRow } from '../admin';
import type { Approval, Chat, Message, StreamEvent, ToolCall } from '../types';

type Handler = (ctx: { params: string[]; query: URLSearchParams; body: Record<string, unknown> }) => unknown;

class HttpError {
  status: number;
  error: string;
  constructor(status: number, error: string) {
    this.status = status;
    this.error = error;
  }
}

const SESSION_KEY = 'mock.session';
const iso = () => new Date().toISOString();
let seq = 1000;
const id = (prefix: string) => `${prefix}-${++seq}`;

function sessionUser(): AdminUserRow {
  const uid = localStorage.getItem(SESSION_KEY);
  const user = db.users.find((u) => u.id === uid);
  if (!user) throw new HttpError(401, 'Not signed in');
  return user;
}

const jobs = new Map<string, { chatId: string; content: string }>();
const mcpApps = [
  { id: 'app-1', client_name: 'ChatGPT', client_uri: 'https://chatgpt.com', scopes: ['canvas.read', 'degreeworks.read', 'memory'] as ('canvas.read' | 'degreeworks.read' | 'memory' | 'workspace')[], created_at: iso(), last_used_at: iso() },
  { id: 'app-2', client_name: 'Claude', client_uri: 'https://claude.ai', scopes: ['canvas.read', 'workspace', 'memory'] as ('canvas.read' | 'degreeworks.read' | 'memory' | 'workspace')[], created_at: iso(), last_used_at: null },
];
const approvals: Approval[] = [];
let codexPolls = 0;
const mockSettings = {
  general: { registration_enabled: true, beta_test: false, default_language: 'en', default_theme_mode: 'system', default_theme_skin: 'hawk', studyhawk_daily_messages: 100, session_ttl_hours: 168, mcp_enabled: true, codex_enabled: true, codex_disabled_until: null as string | null },
  smtp: { host: 'smtp.gmail.com', port: 587, secure: false, user: 'no-reply@studyhawk.app', password_set: true, from_name: 'StudyHawk', from_email: 'no-reply@studyhawk.app' },
  sandbox: { image: 'ghcr.io/pixlgalaxy/studyhawk-sandbox:latest', default_cpu: 0.5, default_mem_mb: 512, default_disk_mb: 5120, max_active_per_node: 4, idle_timeout_minutes: 15, throttle_cpu: 0.25, network: 'open', network_list: [] as string[] },
  push: { vapid_public_key: 'BNbV3s3E4cPq0wP3u4oFv9M2u0n2T3x1Yb4ZQ7m8K1aJx0YfS2o9r6c7d8e9f0g1h2i3j4k5l6m7n8o9p0q1r2s3', subscriptions: 37, contact_email: 'admin@studyhawk.app' },
  billing: { enabled: false, stripe_secret_set: false, stripe_webhook_secret_set: false, grace_days: 3 },
  memoryPaused: false,
};

const routes: [string, RegExp, Handler][] = [
  ['GET', /^\/config$/, () => ({
    language: 'en',
    defaultThemeMode: 'system',
    defaultThemeSkin: 'hawk',
    registrationEnabled: true,
    emailConfigured: true,
    betaTest: false,
    institutions: db.institutions.map((i) => ({ name: i.name, domains: i.domains.map((d) => d.domain) })),
    billingEnabled: mockSettings.billing.enabled,
    codexEnabled: mockSettings.general.codex_enabled && !mockSettings.general.codex_disabled_until,
    mcpEnabled: mockSettings.general.mcp_enabled,
    vapidPublicKey: mockSettings.push.vapid_public_key,
    broadcast: null,
  })],

  // auth
  ['GET', /^\/auth\/me$/, () => ({ user: db.asUser(sessionUser()) })],
  ['POST', /^\/auth\/login$/, ({ body }) => {
    const identity = String(body.usernameOrEmail ?? '').toLowerCase();
    const user = identity.includes('admin') || identity === 'pixl' ? db.users[0]! : db.users[1]!;
    if (identity.includes('jnakamura')) throw new HttpError(403, 'Email not verified');
    localStorage.setItem(SESSION_KEY, user.id);
    return { user: db.asUser(user) };
  }],
  ['POST', /^\/auth\/logout$/, () => {
    localStorage.removeItem(SESSION_KEY);
  }],
  ['POST', /^\/auth\/register$/, ({ body }) => {
    const email = String(body.email);
    if (!email.endsWith('fgcu.edu')) throw new HttpError(403, 'Your university does not have an agreement with StudyHawk yet.');
    return { email, expires_at: new Date(Date.now() + 72 * 3600 * 1000).toISOString() };
  }],
  ['POST', /^\/auth\/verify$/, ({ body }) => {
    if (body.code && body.code !== '123456') throw new HttpError(400, 'That code is not valid. Try again or request a new one.');
    localStorage.setItem(SESSION_KEY, db.users[1]!.id);
    return { user: db.asUser(db.users[1]!) };
  }],
  ['POST', /^\/auth\/(resend-verification|forgot-password|reset-password|change-password)$/, () => undefined],
  ['PATCH', /^\/auth\/profile$/, ({ body }) => Object.assign(sessionUser(), body, { updated_at: iso() }) && db.asUser(sessionUser())],
  ['POST', /^\/auth\/appearance$/, ({ body }) => {
    const user = sessionUser();
    if (body.mode) user.theme_mode = String(body.mode);
    if (body.skin) user.theme_skin = String(body.skin);
    if (body.language) user.language = String(body.language);
    return db.asUser(user);
  }],

  // chats
  ['GET', /^\/chats$/, () => [...db.chats].sort((a, b) => b.updated_at.localeCompare(a.updated_at))],
  ['POST', /^\/chats$/, ({ body }) => {
    const chat: Chat = { id: id('c'), title: 'New chat', model_ref: (body.model_ref as string) ?? 'auto', created_at: iso(), updated_at: iso(), active_job_id: null };
    db.chats.unshift(chat);
    return chat;
  }],
  ['GET', /^\/chats\/([^/]+)$/, ({ params }) => {
    const chat = db.chats.find((c) => c.id === params[0]);
    if (!chat) throw new HttpError(404, 'Chat not found');
    return { chat, messages: db.messages[chat.id] ?? [], pending_approvals: approvals.filter((a) => a.status === 'pending' && jobs.get(a.job_id)?.chatId === chat.id), background_jobs: [] };
  }],
  ['PATCH', /^\/chats\/([^/]+)$/, ({ params, body }) => Object.assign(db.chats.find((c) => c.id === params[0])!, { title: body.title })],
  ['DELETE', /^\/chats\/([^/]+)$/, ({ params }) => {
    db.chats.splice(db.chats.findIndex((c) => c.id === params[0]), 1);
  }],
  ['POST', /^\/chats\/([^/]+)\/messages$/, ({ params, body }) => {
    const chat = db.chats.find((c) => c.id === params[0])!;
    const message: Message = { id: id('m'), role: 'user', content: String(body.content), model_ref: null, created_at: iso() };
    (db.messages[chat.id] ??= []).push(message);
    const jobId = id('job');
    jobs.set(jobId, { chatId: chat.id, content: message.content });
    chat.active_job_id = jobId;
    if (chat.title === 'New chat') chat.title = message.content.slice(0, 40);
    chat.updated_at = iso();
    return { job_id: jobId, message };
  }],
  ['POST', /^\/chats\/([^/]+)\/compact$/, () => ({ context: { used: 9_400, window: 272_000 }, summarized: 6 })],
  ['POST', /^\/jobs\/([^/]+)\/cancel$/, () => undefined],
  ['POST', /^\/jobs\/([^/]+)\/steer$/, ({ body }) => ({ id: id('steer'), content: body.content, created_at: iso() })],
  ['POST', /^\/approvals\/([^/]+)\/(approve|reject)$/, ({ params }) => {
    const approval = approvals.find((a) => a.id === params[0]);
    if (approval) approval.status = params[1] === 'approve' ? 'approved' : 'rejected';
  }],
  ['GET', /^\/jobs$/, () => []],

  // models and connections
  ['GET', /^\/models$/, () => db.modelOptions],
  ['GET', /^\/models\/prefs$/, () => ({ mode: 'auto', default_model_ref: null, auto_map: { fast: 'studyhawk:ep1:gemma4', smart: 'codex:conn-codex:gpt-5' } })],
  ['PUT', /^\/models\/prefs$/, ({ body }) => body],
  ['POST', /^\/connections\/codex\/device$/, () => {
    codexPolls = 0;
    return { verification_uri: 'https://auth.openai.com/codex/device', user_code: 'K7QD-M2XP', device_auth_id: 'dev-1', interval: 2, expires_at: iso() };
  }],
  ['POST', /^\/connections\/codex\/poll$/, () => (++codexPolls < 3 ? { status: 'pending' } : { status: 'connected', connection: db.connections.find((c) => c.kind === 'codex') })],
  ['POST', /^\/connections\/api-keys$/, ({ body }) => {
    const conn = { id: id('conn'), kind: 'api_key' as const, provider: String(body.provider), label: String(body.label), status: 'ok' as const, last_ok_at: iso(), last_error: null, meta: { key_hint: `...${String(body.api_key).slice(-4)}` } };
    db.connections.push(conn);
    return conn;
  }],
  ['GET', /^\/connections$/, () => ({
    connections: db.connections,
    institution: { name: 'FGCU', canvas_base_url: 'https://fgcu.instructure.com', has_degreeworks: true, has_outlook: true },
  })],
  ['PUT', /^\/connections\/canvas$/, () => ({ ...db.connections[0]!, last_ok_at: iso() })],
  ['PUT', /^\/connections\/sso$/, () => {
    const conn = { id: 'conn-sso', kind: 'sso' as const, provider: null, label: 'FGCU', status: 'waiting_mfa' as const, last_ok_at: null, last_error: null, meta: {} };
    db.connections.push(conn);
    return conn;
  }],
  ['PUT', /^\/connections\/degreeworks$/, ({ body }) => ({ id: 'conn-dw', kind: 'degreeworks', provider: null, label: 'Degree Works', status: 'ok', last_ok_at: iso(), last_error: null, meta: { enabled: String(body.enabled) } })],
  ['POST', /^\/connections\/([^/]+)\/test$/, ({ params }) => ({ ...db.connections.find((c) => c.id === params[0])!, status: 'ok', last_ok_at: iso() })],
  ['DELETE', /^\/connections\/([^/]+)$/, ({ params }) => {
    const i = db.connections.findIndex((c) => c.id === params[0]);
    if (i >= 0) db.connections.splice(i, 1);
  }],

  // canvas, files
  ['GET', /^\/canvas\/courses$/, () => db.courses],
  ['GET', /^\/canvas\/upcoming$/, () => db.upcoming],
  ['GET', /^\/canvas\/courses\/(\d+)$/, ({ params }) => {
    const course = db.courses.find((c) => c.id === Number(params[0]))!;
    return { course, items: db.upcoming.filter((i) => i.course_id === course.id), announcements: db.announcements.filter((a) => a.course_id === course.id) };
  }],
  ['GET', /^\/files$/, ({ query }) => ({ entries: db.files[query.get('path') ?? ''] ?? [], usage: { used_mb: 214, limit_mb: 5120 }, temp: { used_mb: 38, limit_mb: 10240, ttl_hours: 24 } })],
  ['POST', /^\/files\/upload$/, ({ query, body }) => {
    const file = body.file;
    if (!(file instanceof File)) throw new HttpError(400, 'No file');
    const dir = query.get('path') ?? '';
    const entry = { name: file.name, path: dir ? `${dir}/${file.name}` : file.name, type: 'file' as const, size: file.size, modified_at: iso() };
    // Same name in the same folder: the new one replaces it, like the real workspace.
    const list = (db.files[dir] ??= []);
    const i = list.findIndex((e) => e.path === entry.path);
    if (i >= 0) list.splice(i, 1);
    list.push(entry);
    return entry;
  }],
  ['POST', /^\/files\/mkdir$/, ({ body }) => {
    const path = String(body.path);
    const parent = path.split('/').slice(0, -1).join('/');
    (db.files[parent] ??= []).push({ name: path.split('/').pop()!, path, type: 'dir', size: 0, modified_at: iso() });
  }],
  ['DELETE', /^\/files$/, ({ query }) => {
    for (const list of Object.values(db.files)) {
      const i = list.findIndex((e) => e.path === query.get('path'));
      if (i >= 0) list.splice(i, 1);
    }
  }],

  ['GET', /^\/browser$/, () => db.browser],
  ['POST', /^\/browser\/trusted$/, ({ body }) => {
    const domain = String(body.domain).replace(/^https?:\/\//, '').split('/')[0]!.replace(/^www\./, '').toLowerCase();
    if (!db.browser.trusted.some((t) => t.domain === domain)) db.browser.trusted.push({ domain, created_at: iso() });
    return { domain };
  }],
  ['DELETE', /^\/browser\/trusted\/([^/]+)$/, ({ params }) => {
    db.browser.trusted = db.browser.trusted.filter((t) => t.domain !== decodeURIComponent(params[0]!));
  }],
  ['DELETE', /^\/browser\/profiles\/([^/]+)$/, ({ params }) => {
    db.browser.profiles = db.browser.profiles.filter((p) => p !== params[0]);
  }],
  ['GET', /^\/rags$/, () => db.rags],
  ['DELETE', /^\/rags\/([^/]+)$/, ({ params }) => {
    const i = db.rags.findIndex((r) => r.id === params[0]);
    if (i >= 0) db.rags.splice(i, 1);
  }],

  // MCP apps + OAuth consent
  ['GET', /^\/mcp-apps$/, () => ({
    enabled: mockSettings.general.mcp_enabled,
    server_url: `${location.origin}/mcp`,
    apps: mcpApps,
  })],
  ['DELETE', /^\/mcp-apps\/([^/]+)$/, ({ params }) => {
    const i = mcpApps.findIndex((a) => a.id === params[0]);
    if (i >= 0) mcpApps.splice(i, 1);
  }],
  ['GET', /^\/oauth\/requests\/([^/]+)$/, ({ params }) => ({
    request_id: params[0],
    client_name: 'ChatGPT',
    client_uri: 'https://chatgpt.com',
    redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect',
    scopes: ['canvas.read', 'degreeworks.read', 'workspace', 'memory'],
  })],
  ['POST', /^\/oauth\/requests\/([^/]+)$/, ({ body }) => ({ redirect_to: body.approve ? '/settings?section=apps' : '/chat' })],

  // memory, skills, schedules, push, billing
  ['GET', /^\/memories$/, () => ({ docs: db.memoryDocs, limits: { soul: 3000, user: 1500, notes: 2500 }, paused: mockSettings.memoryPaused })],
  ['PUT', /^\/memories\/docs\/(soul|user|notes)$/, ({ params, body }) => {
    db.memoryDocs[params[0] as 'soul' | 'user' | 'notes'] = String(body.content ?? '');
    return { docs: db.memoryDocs, limits: { soul: 3000, user: 1500, notes: 2500 } };
  }],
  ['PUT', /^\/memories\/paused$/, ({ body }) => {
    mockSettings.memoryPaused = Boolean(body.paused);
  }],
  ['GET', /^\/skills$/, () => db.skills],
  ['PUT', /^\/skills\/([^/]+)\/enabled$/, ({ params, body }) => Object.assign(db.skills.find((s) => s.slug === params[0])!, { enabled: body.enabled })],
  ['DELETE', /^\/skills\/([^/]+)\/notes\/([^/]+)$/, () => undefined],
  ['POST', /^\/skills$/, ({ body }) => {
    const skill = { slug: id('skill'), name: String(body.name), description: String(body.description), body_md: String(body.body_md), builtin: false, enabled: true, notes: [] };
    db.skills.push(skill);
    return skill;
  }],
  ['PUT', /^\/skills\/([^/]+)$/, ({ params, body }) => Object.assign(db.skills.find((s) => s.slug === params[0])!, body)],
  ['DELETE', /^\/skills\/([^/]+)$/, () => undefined],
  ['GET', /^\/schedules$/, () => db.schedules],
  ['POST', /^\/schedules$/, ({ body }) => ({ ...body, id: id('s'), next_run_at: iso(), last_run_at: null })],
  ['PATCH', /^\/schedules\/([^/]+)$/, ({ params, body }) => Object.assign(db.schedules.find((s) => s.id === params[0]) ?? {}, body)],
  ['DELETE', /^\/schedules\/([^/]+)$/, () => undefined],
  ['POST', /^\/push\/.*/, () => undefined],
  ['GET', /^\/billing\/plan$/, () => ({ tier: db.tiers[0], billing_enabled: true, subscription_status: null, current_period_end: null, usage_today: { messages: 23, tokens_in: 48211, tokens_out: 12007 } })],
  ['GET', /^\/usage$/, () => ({
    plan: { name: 'Free', cpu: 0.5, mem_mb: 512 },
    compute: {
      day: { used: 1.42, limit: 2, resets_at: new Date(Date.now() + 9 * 3_600_000).toISOString() },
      week: { used: 6.1, limit: 10, resets_at: new Date(Date.now() + 80 * 3_600_000).toISOString() },
      throttled: false,
      throttle_cpu: 0.25,
      sandbox: { cpu_percent: 37, mem_mb: 212 },
    },
    models: { studyhawk_messages: 23, daily_limit: 100, messages: 31, tokens_in: 48211, tokens_out: 12007 },
    storage: { used_mb: 1830, limit_mb: 5120, temp_used_mb: 96, temp_limit_mb: 1024 },
    history: [0.4, 1.9, 0, 0.8, 1.1, 0.5, 1.42].map((compute, i) => ({ day: new Date(Date.now() - (6 - i) * 86_400_000).toISOString().slice(0, 10), compute, messages: [12, 40, 0, 18, 25, 9, 23][i] })),
  })],
  ['GET', /^\/billing\/tiers$/, () => db.tiers.filter((t) => t.enabled)],
  ['POST', /^\/billing\/(checkout|portal)$/, () => ({ url: '#' })],

  // admin
  ['GET', /^\/admin\/overview$/, () => ({
    users: { total: db.users.length, active: 3, pending: 1 },
    chats_today: 128,
    jobs_running: 2,
    sandboxes_active: db.sandboxes.length,
    nodes_online: db.nodes.length,
    alerts: [{ level: 'warning', message: 'Stripe billing is off. Plans can still be assigned by hand.', section: 'billing' }],
  })],
  ['GET', /^\/admin\/users$/, ({ query }) => db.users.filter((u) => `${u.username} ${u.email} ${u.display_name}`.toLowerCase().includes((query.get('q') ?? '').toLowerCase()))],
  ['POST', /^\/admin\/users$/, ({ body }) => ({ ...db.users[1]!, ...body, id: id('u'), last_seen_at: null, verification_expires_at: null })],
  ['PATCH', /^\/admin\/users\/([^/]+)$/, ({ params, body }) => Object.assign(db.users.find((u) => u.id === params[0])!, body)],
  ['POST', /^\/admin\/users\/([^/]+)\/password$/, () => undefined],
  ['DELETE', /^\/admin\/users\/([^/]+)$/, () => undefined],
  ['GET', /^\/admin\/institutions$/, () => db.institutions],
  ['POST', /^\/admin\/institutions$/, ({ body }) => ({ ...body, id: id('inst'), slug: 'new', user_count: 0 })],
  ['PUT', /^\/admin\/institutions\/([^/]+)$/, ({ params, body }) => Object.assign(db.institutions.find((i) => i.id === params[0])!, body)],
  ['DELETE', /^\/admin\/institutions\/([^/]+)$/, () => undefined],
  ['GET', /^\/admin\/skills$/, () => [
    { slug: 'canvas-lms', name: 'Canvas', description: '' },
    { slug: 'academic-email', name: 'School email', description: '', requires: 'outlook' },
    { slug: 'academic-email-drafting', name: 'Email drafting', description: '', requires: 'outlook' },
    { slug: 'degreeworks-map', name: 'Degree map', description: '', requires: 'degreeworks' },
    { slug: 'study-coaching', name: 'Study coaching', description: '' },
    { slug: 'assignment-drafting', name: 'Assignment drafting', description: '' },
  ]],
  ['GET', /^\/admin\/smtp$/, () => mockSettings.smtp],
  ['PUT', /^\/admin\/smtp$/, ({ body }) => Object.assign(mockSettings.smtp, body, { password_set: true })],
  ['POST', /^\/admin\/smtp\/test$/, () => undefined],
  ['GET', /^\/admin\/models\/endpoints$/, () => db.endpoints],
  ['POST', /^\/admin\/models\/endpoints$/, ({ body }) => ({ ...body, id: id('ep'), enabled: true, models: [] })],
  ['POST', /^\/admin\/models\/endpoints\/([^/]+)\/discover$/, ({ params }) => db.endpoints.find((e) => e.id === params[0])],
  ['DELETE', /^\/admin\/models\/endpoints\/([^/]+)$/, () => undefined],
  ['PATCH', /^\/admin\/models\/([^/]+)$/, ({ params, body }) => Object.assign(db.endpoints.flatMap((e) => e.models).find((m) => m.id === params[0])!, body)],
  ['GET', /^\/admin\/sandbox$/, () => mockSettings.sandbox],
  ['PUT', /^\/admin\/sandbox$/, ({ body }) => Object.assign(mockSettings.sandbox, body)],
  ['GET', /^\/admin\/sandboxes$/, () => db.sandboxes],
  ['POST', /^\/admin\/sandboxes\/([^/]+)\/stop$/, () => undefined],
  ['GET', /^\/admin\/nodes$/, () => db.nodes.map((n) => ({ ...n, heartbeat_at: new Date(Date.now() - 8000).toISOString() }))],
  ['GET', /^\/admin\/settings$/, () => mockSettings.general],
  ['PATCH', /^\/admin\/settings$/, ({ body }) => Object.assign(mockSettings.general, body)],
  ['GET', /^\/admin\/push$/, () => mockSettings.push],
  ['PUT', /^\/admin\/push$/, ({ body }) => Object.assign(mockSettings.push, body)],
  ['POST', /^\/admin\/push\/vapid$/, () => mockSettings.push],
  ['POST', /^\/admin\/push\/broadcast$/, () => ({ sent: mockSettings.push.subscriptions })],
  ['GET', /^\/admin\/tiers$/, () => db.tiers],
  ['POST', /^\/admin\/tiers$/, ({ body }) => ({ ...body, id: id('tier') })],
  ['PUT', /^\/admin\/tiers\/([^/]+)$/, ({ params, body }) => Object.assign(db.tiers.find((t) => t.id === params[0])!, body)],
  ['DELETE', /^\/admin\/tiers\/([^/]+)$/, () => undefined],
  ['GET', /^\/admin\/billing$/, () => mockSettings.billing],
  ['PUT', /^\/admin\/billing$/, ({ body }) => Object.assign(mockSettings.billing, body)],
  ['GET', /^\/admin\/logs$/, () => {
    const entries = [
      { id: 6, node_id: 'node-2', time: '2026-10-13T08:03:47Z', channel: 'BACKEND', level: 'ERROR', message: 'canvas 401 for tbeckett: token expired' },
      { id: 5, node_id: 'node-1', time: '2026-10-13T08:03:10Z', channel: 'FRONTEND', level: 'INFO', message: 'GET /chat 200 0.4ms' },
      { id: 4, node_id: 'node-2', time: '2026-10-13T08:02:02Z', channel: 'AUTH', level: 'INFO', message: 'Deleted unverified sign-up <old@fgcu.edu>' },
      { id: 3, node_id: 'node-1', time: '2026-10-13T08:01:20Z', channel: 'BACKEND', level: 'WARN', message: 'outlook session for mrodriguez needs Duo, push sent' },
      { id: 2, node_id: 'node-1', time: '2026-10-13T08:01:13Z', channel: 'SYSTEM', level: 'INFO', message: '"pixl" updated the SMTP settings' },
      { id: 1, node_id: 'node-1', time: '2026-10-13T08:00:01Z', channel: 'ENTRYPOINT', level: 'INFO', message: 'nginx and backend started' },
    ];
    return { entries, total: entries.length, pages: 1, limit: 100, capacity: 100000, nodes: ['node-1', 'node-2'] };
  }],
];

async function handle(method: string, path: string, query: URLSearchParams, body: Record<string, unknown>): Promise<Response> {
  await new Promise((r) => setTimeout(r, 120 + Math.random() * 180));
  for (const [m, pattern, handler] of routes) {
    if (m !== method) continue;
    const match = path.match(pattern);
    if (!match) continue;
    try {
      const result = handler({ params: match.slice(1), query, body });
      return result === undefined ? new Response(null, { status: 204 }) : Response.json(result);
    } catch (err) {
      if (err instanceof HttpError) return Response.json({ error: err.error }, { status: err.status });
      throw err;
    }
  }
  return Response.json({ error: `Mock has no route for ${method} ${path}` }, { status: 404 });
}

// ------------------------------------------------------------- streaming

function script(chatId: string, jobId: string, prompt: string): { delay: number; event: StreamEvent }[] {
  const wantsEmail = /email|correo/i.test(prompt);
  const out: { delay: number; event: StreamEvent }[] = [
    { delay: 300, event: { type: 'status', status: 'running' } },
    { delay: 200, event: { type: 'model', model_ref: 'codex:conn-codex:gpt-5', model_label: 'Auto -> GPT-5' } },
  ];
  const call = (name: string, args: Record<string, unknown>): ToolCall => ({ id: id('t'), name, args, status: 'running' });

  if (wantsEmail) {
    const session = call('email.ensure_session', {});
    out.push({ delay: 300, event: { type: 'tool_call', call: session } });
    out.push({ delay: 600, event: { type: 'mfa_required', service: 'outlook', message: 'Approve the Duo push sent to your phone ending in 42.' } });
    out.push({ delay: 2600, event: { type: 'tool_result', call: { ...session, status: 'done' } } });
    const draft = call('email.draft', { to: 'prof.martinez@fgcu.edu' });
    out.push({ delay: 300, event: { type: 'tool_call', call: draft } });
    out.push({ delay: 700, event: { type: 'tool_result', call: { ...draft, status: 'done' } } });
    const approval: Approval = {
      id: id('ap'),
      job_id: jobId,
      tool_name: 'email.send',
      summary: 'StudyHawk wants to send this email from your FGCU account.',
      details: { To: 'prof.martinez@fgcu.edu', Subject: 'Question about Draft 2', Body: 'Hi Professor Martinez,\n\nCould you clarify whether the counterargument section counts toward the 1,500 word minimum?\n\nThank you,\nMariana' },
      status: 'pending',
    };
    approvals.push(approval);
    out.push({ delay: 300, event: { type: 'tool_call', call: { ...call('email.send', {}), status: 'waiting_approval' } } });
    out.push({ delay: 100, event: { type: 'approval_required', approval } });
    out.push({ delay: 200, event: { type: 'delta', text: "I drafted the email below. It won't be sent unless you approve it." } });
  } else {
    // The plan above the message box: it rises, then moves step by step.
    const steps = ['Read Canvas', 'Rank the work', 'Estimate the hours', 'Write the plan'];
    const plan = (current: number): StreamEvent => ({
      type: 'plan',
      title: 'Your week',
      steps: steps.map((title, i) => ({ title, status: i < current ? 'done' : i === current ? 'in_progress' : 'pending' })),
    });
    out.push({ delay: 300, event: plan(0) });
    const up = call('canvas.upcoming', { days: 7 });
    out.push({ delay: 300, event: { type: 'tool_call', call: up } });
    out.push({ delay: 900, event: { type: 'tool_result', call: { ...up, status: 'done', result_preview: '3 items' } } });
    out.push({ delay: 700, event: plan(1) });
    out.push({ delay: 900, event: plan(2) });
    out.push({ delay: 900, event: plan(3) });
    const answer = 'Here is your week, ordered by priority:\n\n1. **Guided Practice 6** (ACG 2021), due Wednesday. About 1.5 h.\n2. **Draft 2** (ENC 1102), due Saturday. About 3 h; the rubric changed.\n3. **Connect Quiz 4** (MAN 3025), due Thursday. About 1 h.\n\nWant me to block time for these around your library shifts?';
    for (const word of answer.split(/(?<= )/)) out.push({ delay: 35, event: { type: 'delta', text: word } });
    out.push({ delay: 100, event: plan(4) });
  }

  const final = (content: string): Message => ({
    id: id('m'),
    role: 'assistant',
    content,
    model_ref: 'codex:conn-codex:gpt-5',
    model_label: 'Auto -> GPT-5',
    tool_calls: [],
    created_at: iso(),
  });
  out.push({ delay: 200, event: { type: 'done', message: final('') } });
  // The done message is rebuilt from the deltas when it fires (see below).
  void chatId;
  return out;
}

class MockEventSource {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  readyState = 1;
  private timers: ReturnType<typeof setTimeout>[] = [];
  url: string;

  constructor(url: string) {
    this.url = url;
    const u = new URL(url, location.origin);
    const chatId = u.pathname.split('/')[3]!;
    const jobId = u.searchParams.get('job')!;
    const job = jobs.get(jobId);
    if (!job) return;
    let text = '';
    const calls = new Map<string, ToolCall>();
    let at = 0;
    for (const step of script(chatId, jobId, job.content)) {
      at += step.delay;
      this.timers.push(
        setTimeout(() => {
          const event = step.event;
          if (event.type === 'delta') text += event.text;
          if (event.type === 'tool_call' || event.type === 'tool_result') calls.set(event.call.id, event.call);
          if (event.type === 'done') {
            event.message.content = text;
            event.message.tool_calls = [...calls.values()];
            (db.messages[chatId] ??= []).push(event.message);
            const chat = db.chats.find((c) => c.id === chatId);
            if (chat) chat.active_job_id = null;
          }
          this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(event) }));
        }, at),
      );
    }
  }

  close() {
    this.readyState = 2;
    this.timers.forEach(clearTimeout);
  }
  addEventListener() {}
  removeEventListener() {}
}

/**
 * The chat's attachment chips upload with XHR (for progress). Requests to /api/
 * go to the mock routes and report the whole file sent; anything else is a real XHR.
 */
function mockXhr(Real: typeof XMLHttpRequest): typeof XMLHttpRequest {
  return class MockXhr extends Real {
    private mock: { method: string; url: URL } | null = null;
    private result = { status: 0, text: '' };
    private aborted = false;

    open(method: string, url: string | URL, ...rest: [boolean?, string?, string?]) {
      const u = new URL(String(url), location.origin);
      if (u.pathname.startsWith('/api/')) this.mock = { method: method.toUpperCase(), url: u };
      else super.open(method, url, ...(rest as [boolean, string?, string?]));
    }
    setRequestHeader(name: string, value: string) {
      if (!this.mock) super.setRequestHeader(name, value);
    }
    get status() {
      return this.mock ? this.result.status : super.status;
    }
    get responseText() {
      return this.mock ? this.result.text : super.responseText;
    }
    abort() {
      if (!this.mock) return super.abort();
      this.aborted = true;
      this.onabort?.(new ProgressEvent('abort'));
    }
    send(body?: Document | XMLHttpRequestBodyInit | null) {
      if (!this.mock) return super.send(body);
      const { method, url } = this.mock;
      const fields = body instanceof FormData ? Object.fromEntries(body) : typeof body === 'string' ? JSON.parse(body) : {};
      const size = Object.values(fields).reduce<number>((n, v) => n + (v instanceof File ? v.size : 0), 0);
      void handle(method, url.pathname.slice(4), url.searchParams, fields).then(async (res) => {
        if (this.aborted) return;
        this.upload.onprogress?.call(this, new ProgressEvent('progress', { lengthComputable: true, loaded: size, total: size }));
        this.result = { status: res.status, text: await res.text() };
        this.onload?.(new ProgressEvent('load'));
      });
    }
  };
}

export function installMockApi() {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.origin);
    if (!url.pathname.startsWith('/api/')) return realFetch(input, init);
    const method = (init?.method ?? 'GET').toUpperCase();
    let body: Record<string, unknown> = {};
    if (typeof init?.body === 'string') body = JSON.parse(init.body);
    // Uploads send a form: its fields (the File included) become the body.
    if (init?.body instanceof FormData) body = Object.fromEntries(init.body);
    return handle(method, url.pathname.slice(4), url.searchParams, body);
  };
  (window as unknown as { EventSource: unknown }).EventSource = MockEventSource;
  (window as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = mockXhr(window.XMLHttpRequest);
  console.info('[mock] StudyHawk mock API installed. Sign in with any password; use "admin" for the admin role, or code 123456 to verify.');
}
