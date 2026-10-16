// Phase 3 end-to-end: Canvas connection, Courses views, the agent's Canvas tools, revoked tokens and secret redaction.
// Needs: dev backend on E2E_A (dev seed accounts), fake-canvas.mjs on 4998, fake-llm.mjs on 4999.
const A = process.env.E2E_A ?? 'http://localhost:4000/api';
const CANVAS = process.env.E2E_CANVAS ?? 'http://localhost:4998';
const LLM = process.env.E2E_LLM ?? 'http://localhost:4999/v1';
const TOKEN = 'canvas-test-token-0123456789';
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
  async stream(chatId, jobId) {
    const res = await fetch(`${A}/chats/${chatId}/stream?job=${jobId}`, { headers: this.headers('GET') });
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

const admin = await login('admin', 'admin');
const user = await login('user', 'user');

// The dev university points at the fake Canvas.
let r = await admin.req('GET', '/admin/institutions');
const inst = r.json.find((i) => i.slug === 'dev-university');
r = await admin.req('PUT', `/admin/institutions/${inst.id}`, { ...inst, canvas_base_url: CANVAS });
check('institution points to Canvas', r.status === 200 && r.json.canvas_base_url === CANVAS, r.json?.error);

r = await user.req('GET', '/canvas/courses');
check('not connected answers 412', r.status === 412, `${r.status} ${r.json?.error}`);

r = await user.req('PUT', '/connections/canvas', { token: 'short' });
check('malformed token refused', r.status === 400, r.json?.error);
r = await user.req('PUT', '/connections/canvas', { token: 'wrong-token-but-long-enough-000' });
check('wrong token refused with a clear message', r.status === 400 && /token/i.test(r.json.error), r.json?.error);
r = await user.req('PUT', '/connections/canvas', { token: TOKEN });
check('valid token saved', r.status === 200 && r.json.kind === 'canvas' && r.json.meta.name === 'Dev Student', JSON.stringify(r.json));
check('token never returned', !r.raw.includes(TOKEN) && r.json.meta.token_hint === '...6789');
const canvasConnId = r.json.id;

r = await user.req('GET', '/canvas/courses');
check('active courses (restricted one hidden)', r.status === 200 && r.json.length === 3 && r.json[0].current_grade === 'A-', JSON.stringify(r.json).slice(0, 160));
check('current term first, org page last and not current', r.json[0].current && r.json[1].current && r.json[2].name === 'Advising Resources' && r.json[2].current === false);

r = await user.req('GET', '/canvas/upcoming?days=14');
const titles = r.json.map((i) => i.title);
check('upcoming 14 days', r.status === 200 && titles.includes('Chapter 4 Homework') && titles.includes('Lab report 2'), titles.join(' | '));
check('overdue unsubmitted kept, submitted past dropped', titles.includes('Late reflection') && !titles.includes('Chapter 3 Homework'));
check('far-future practice sets excluded', !titles.some((t) => t.startsWith('Practice set')));
check('planner notes are not work', !titles.includes('My personal note'));
check('calendar event without assignment included once', titles.filter((t) => /exam review/.test(t)).length === 1 && titles.filter((t) => t === 'Chapter 4 Homework').length === 1);
const hw = r.json.find((i) => i.title === 'Chapter 4 Homework');
check('item has estimate and priority', hw.estimate_hours === 1.5 && hw.priority > 50 && hw.kind === 'assignment', JSON.stringify(hw));
check('links point at Canvas, not at StudyHawk', hw.html_url.startsWith(`${CANVAS}/courses/101/assignments/1`), hw.html_url);
check('quiz recognized', r.json.find((i) => i.title === 'Quiz 3')?.kind === 'quiz');
check('sorted by due date', r.json.every((item, i, all) => i === 0 || (all[i - 1].due_at ?? '') <= (item.due_at ?? '')));

r = await user.req('GET', '/canvas/courses/101');
check('course detail follows pagination (110 assignments)', r.status === 200 && r.json.items.length === 110, String(r.json.items?.length));
check('announcement html stripped', r.json.announcements[0]?.preview.startsWith('Quiz 3 is now Thursday.'), r.json.announcements[0]?.preview);
r = await user.req('GET', '/canvas/courses/999');
check('unknown course is 404', r.status === 404);

r = await user.req('POST', `/connections/${canvasConnId}/test`);
check('test connection', r.status === 200 && r.json.status === 'ok');

// ---------------------------------------------------------------- the agent uses Canvas
r = await admin.req('POST', '/admin/models/endpoints', { kind: 'openai_compat', name: 'Fake GPU', base_url: LLM });
const ep = r.json;
r = await admin.req('POST', `/admin/models/endpoints/${ep.id}/discover`);
for (const m of r.json.models) await admin.req('PATCH', `/admin/models/${m.id}`, { enabled: true, tags: ['smart', 'fast'], supports_tools: true });
await admin.req('PATCH', '/admin/settings', { studyhawk_daily_messages: 0 });

r = await user.req('POST', '/chats', {});
const chatId = r.json.id;
r = await user.req('POST', `/chats/${chatId}/messages`, { content: 'what is due this week? [canvas]', model_ref: 'auto' });
let events = await user.stream(chatId, r.json.job_id);
const toolResult = events.find((e) => e.type === 'tool_result' && e.call.name === 'canvas_briefing');
check('agent called canvas_briefing', toolResult?.call.status === 'done', JSON.stringify(toolResult?.call).slice(0, 200));
check('briefing reached the model', /tool said: \{/.test(events.at(-1).message?.content ?? ''), events.at(-1).message?.content);

// Course material kept in pages (Pages tab hidden): saved into TEMP as text, linked files reported.
r = await user.req('POST', `/chats/${chatId}/messages`, { content: 'save the course pages [pages]', model_ref: 'auto' });
events = await user.stream(chatId, r.json.job_id);
const pagesResult = events.find((e) => e.type === 'tool_result' && e.call.name === 'canvas_save_pages');
check('agent saved course pages', pagesResult?.call.status === 'done', JSON.stringify(pagesResult?.call).slice(0, 300));
r = await user.req('GET', `/files?path=${encodeURIComponent('TEMP/canvas-pages/101')}`);
const saved = (r.json.entries ?? []).map((e) => e.name).sort();
check('pages saved as text files in TEMP (locked page skipped)', r.status === 200 && saved.join('|') === 'Chapter 4 notes.md|Syllabus.md', saved.join('|'));
r = await user.req('GET', `/files/download?path=${encodeURIComponent('TEMP/canvas-pages/101/Syllabus.md')}`);
check('page text is clean and links back to Canvas', r.raw.startsWith('# Syllabus') && r.raw.includes('Late work loses 10% per day') && r.raw.includes(`Source: ${CANVAS}/courses/101/pages/syllabus`) && !r.raw.includes('<p>'), r.raw.slice(0, 200));
check('files linked from pages are reported', /linked_file_ids[^\]]*77/.test(pagesResult?.call.result_preview ?? ''), pagesResult?.call.result_preview);
r = await user.req('GET', '/files?path=TEMP');
check('TEMP area reported with its rules', r.json.temp?.limit_mb > 0 && r.json.temp?.ttl_hours === 24, JSON.stringify(r.json.temp));
r = await user.req('GET', '/files');
check('TEMP marked in the root, .rag hidden', r.json.entries.some((e) => e.name === 'TEMP' && e.temp) && !r.json.entries.some((e) => e.name === '.rag'));

// ---------------------------------------------------------------- revoked token
await fetch(`${CANVAS}/__revoke`, { method: 'POST' });
await user.req('POST', '/canvas/refresh');
r = await user.req('GET', '/canvas/courses');
check('revoked token gives a clear 424', r.status === 424 && /token/i.test(r.json.error), `${r.status} ${r.json?.error}`);
r = await user.req('GET', '/connections');
const conn = r.json.connections.find((c) => c.kind === 'canvas');
check('connection marked as error', conn.status === 'error' && conn.last_error, JSON.stringify(conn));
check('connections list hides the token', !r.raw.includes(TOKEN));

r = await user.req('POST', `/chats/${chatId}/messages`, { content: 'again [canvas]', model_ref: 'auto' });
events = await user.stream(chatId, r.json.job_id);
const failed = events.find((e) => e.type === 'tool_result' && e.call.name === 'canvas_briefing');
check('agent gets an actionable error, chat survives', failed?.call.status === 'error' && /Settings > Connections/.test(failed.call.result_preview) && events.at(-1).type === 'done', failed?.call.result_preview);

// ---------------------------------------------------------------- SSO and Degree Works cards
r = await user.req('PUT', '/connections/sso', { email: 'user@studyhawk.test', password: 'school-password-123' });
check('school account saved', r.status === 200 && r.json.kind === 'sso' && r.json.status === 'untested' && !r.raw.includes('school-password-123'));
r = await user.req('PUT', '/connections/degreeworks', { enabled: true });
check('degree works toggle', r.status === 200 && r.json.meta.enabled === 'true');

// ---------------------------------------------------------------- redaction: the token must not be in the logs
await new Promise((res) => setTimeout(res, 1500));
r = await admin.req('GET', '/admin/logs?limit=1000');
check('logs never contain the Canvas token or the SSO password', r.status === 200 && !r.raw.includes(TOKEN) && !r.raw.includes('school-password-123'));

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
