// Phase 5 skills end-to-end: built-in skills offered by the institution, placeholders filled per student, a learned
// note that shows up in a new chat, the student switching a skill off, and the institution switching Degree Works off
// (skill and tool both disappear). Needs a dev backend on E2E_A and fake-llm.mjs on 4999.
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
    return { status: res.status, json };
  }
  /** A new chat with one message; returns the final answer and the tool results. */
  async ask(content) {
    const chat = (await this.req('POST', '/chats', {})).json;
    const sent = await this.req('POST', `/chats/${chat.id}/messages`, { content, model_ref: 'auto' });
    const res = await fetch(`${A}/chats/${chat.id}/stream?job=${sent.json.job_id}`, { headers: this.headers('GET') });
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
        if (event.type === 'done' || event.type === 'error') {
          const tool = events.filter((e) => e.type === 'tool_result').at(-1)?.call;
          return { answer: event.message?.content ?? event.error, tool };
        }
      }
    }
    return { answer: null };
  }
  async whatCanIDo() {
    const { answer } = await this.ask('[whatcanido]');
    try {
      return JSON.parse(answer);
    } catch {
      return { tools: [], skills: [], raw: answer };
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

let r = await admin.req('POST', '/admin/models/endpoints', { kind: 'openai_compat', name: 'Fake GPU', base_url: LLM });
r = await admin.req('POST', `/admin/models/endpoints/${r.json.id}/discover`);
for (const m of r.json.models) await admin.req('PATCH', `/admin/models/${m.id}`, { enabled: true, tags: ['smart', 'fast'], supports_tools: true });
await admin.req('PATCH', '/admin/settings', { studyhawk_daily_messages: 0 });
await user.req('PATCH', '/auth/profile', { display_name: 'Ana Student', major: 'Accounting' });
const inst = (await admin.req('GET', '/admin/institutions')).json.find((i) => i.slug === 'dev-university');
const saveInst = (patch) => admin.req('PUT', `/admin/institutions/${inst.id}`, { ...inst, outlook_url: 'https://outlook.office.com/mail/', degreeworks_url: 'https://dw.uni.example/', ...patch });
await saveInst({ skills: {} });

// ---------------------------------------------------------------- what admin and the student see
r = await admin.req('GET', '/admin/skills');
const builtins = r.json ?? [];
check('Admin lists the built-in skills', builtins.length >= 10 && builtins.some((s) => s.slug === 'degreeworks-map' && s.requires === 'degreeworks'), builtins.map((s) => s.slug).join(','));
r = await user.req('GET', '/skills');
const mine = r.json ?? [];
check('the student gets them in Settings → Skills', mine.some((s) => s.builtin && s.slug === 'canvas-lms' && s.enabled), mine.map((s) => s.slug).join(','));

let caps = await user.whatCanIDo();
check('the agent is told about them', caps.skills.includes('canvas-lms') && caps.skills.includes('degreeworks-map'), JSON.stringify(caps.skills));
check('and has the Degree Works and email tools', caps.tools.includes('degreeworks_audit') && caps.tools.includes('email_inbox'), caps.tools.filter((t) => /email|degree/.test(t)).join(','));

// ---------------------------------------------------------------- placeholders and learned notes
let res = await user.ask('[skill degreeworks-map]');
check('a skill loads with the student and school filled in', res.tool?.status === 'done' && !/\{\{/.test(res.tool.result_preview), res.tool?.result_preview?.slice(0, 160));
res = await user.ask('[note canvas-lms Ana wants due dates in a table, oldest first]');
check('the agent saves a learned note', res.tool?.status === 'done', res.tool?.result_preview);
res = await user.ask('[skill canvas-lms]');
check('a new chat loads the skill with the note', /oldest first/.test(res.tool?.result_preview ?? '') || /oldest first/.test(JSON.stringify(res.tool ?? {})), res.tool?.result_preview?.slice(-200));
r = await user.req('GET', '/skills');
const noteRow = r.json.find((s) => s.slug === 'canvas-lms')?.notes?.[0];
check('the note shows in Settings → Skills and can be removed', /oldest first/.test(noteRow?.note ?? ''), JSON.stringify(noteRow));
r = await user.req('DELETE', `/skills/canvas-lms/notes/${noteRow?.id}`);
res = await user.ask('[skill canvas-lms]');
check('a removed note is gone next time', !/oldest first/.test(res.tool?.result_preview ?? ''));

// ---------------------------------------------------------------- the student switches one off
r = await user.req('PUT', '/skills/study-coaching/enabled', { enabled: false });
check('a built-in skill can be switched off', r.status === 200 && r.json.enabled === false, JSON.stringify(r.json)?.slice(0, 120));
caps = await user.whatCanIDo();
check('then the agent no longer sees it', !caps.skills.includes('study-coaching'), JSON.stringify(caps.skills));
await user.req('PUT', '/skills/study-coaching/enabled', { enabled: true });
r = await user.req('PUT', '/skills/canvas-lms', { name: 'Hacked', description: 'x', body_md: 'x' });
check('built-in skills cannot be edited by students', r.status === 404, String(r.status));

// ---------------------------------------------------------------- the institution switches Degree Works off
await saveInst({ skills: { 'degreeworks-map': false } });
r = await user.req('GET', '/skills');
check('switched off by the school: gone from Settings', !r.json.some((s) => s.slug === 'degreeworks-map'), r.json.map((s) => s.slug).join(','));
caps = await user.whatCanIDo();
check('and from the agent: skill and tool', !caps.skills.includes('degreeworks-map') && !caps.tools.includes('degreeworks_audit'), caps.tools.filter((t) => /degree/.test(t)).join(',') || 'none');
res = await user.ask('[skill degreeworks-map]');
check('it cannot be loaded either', res.tool?.status === 'error' || /not available|unknown|not found/i.test(res.tool?.result_preview ?? ''), res.tool?.result_preview);
await saveInst({ skills: {}, degreeworks_url: null });
caps = await user.whatCanIDo();
check('a school without Degree Works: no skill, no tool', !caps.skills.includes('degreeworks-map') && !caps.tools.includes('degreeworks_audit'));
await saveInst({ skills: {} });

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
