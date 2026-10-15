// Phase 2 end-to-end: two replicas (A and B), dev seed accounts, fake LLM on 4999.
const A = process.env.E2E_A ?? 'http://localhost:4001/api';
const B = process.env.E2E_B ?? 'http://localhost:4002/api';
const LLM = process.env.E2E_LLM ?? 'http://localhost:4999/v1';
let failures = 0;
const check = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ` (${extra})` : ''}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Client {
  jar = {};
  headers(method, body) {
    const h = { cookie: Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join('; ') };
    if (body !== undefined) h['content-type'] = 'application/json';
    if (this.jar.csrf && method !== 'GET') h['x-csrf-token'] = decodeURIComponent(this.jar.csrf);
    return h;
  }
  keep(res) {
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const [k, ...v] = pair.split('=');
      this.jar[k] = v.join('=');
    }
  }
  async req(base, method, path, body) {
    const res = await fetch(base + path, { method, headers: this.headers(method, body), body: body === undefined ? undefined : JSON.stringify(body) });
    this.keep(res);
    const text = await res.text();
    let json;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = text;
    }
    return { status: res.status, json };
  }
  /** Reads a job's SSE stream until done/error; `onEvent` may act mid-stream. */
  async stream(base, chatId, jobId, onEvent = () => {}, lastEventId) {
    const headers = this.headers('GET');
    if (lastEventId) headers['last-event-id'] = String(lastEventId);
    const res = await fetch(`${base}/chats/${chatId}/stream?job=${jobId}`, { headers });
    const events = [];
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of res.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let i;
      while ((i = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        const data = block.split('\n').find((l) => l.startsWith('data:'));
        const id = block.split('\n').find((l) => l.startsWith('id:'));
        if (!data) continue;
        const event = JSON.parse(data.slice(5));
        event._id = id ? Number(id.slice(3)) : undefined;
        events.push(event);
        await onEvent(event, events);
        if (event.type === 'done' || event.type === 'error') return events;
      }
    }
    return events;
  }
}

const login = async (base, user, pass) => {
  const c = new Client();
  await c.req(base, 'GET', '/config');
  const r = await c.req(base, 'POST', '/auth/login', { usernameOrEmail: user, password: pass });
  if (r.status !== 200) throw new Error(`login ${user}: ${r.status} ${JSON.stringify(r.json)}`);
  return c;
};

const admin = await login(A, 'admin', 'admin');
const user = await login(B, 'user', 'user');

// ---------------------------------------------------------------- admin sets up the EagleDocs model
let r = await admin.req(A, 'POST', '/admin/models/endpoints', { kind: 'openai_compat', name: 'Fake GPU', base_url: LLM });
check('create endpoint', r.status === 201, JSON.stringify(r.json).slice(0, 120));
const endpointId = r.json.id;
r = await admin.req(A, 'POST', `/admin/models/endpoints/${endpointId}/discover`);
check('discover models', r.status === 200 && r.json.models.length === 2, JSON.stringify(r.json).slice(0, 160));
const smart = r.json.models.find((m) => m.model_name === 'fake-smart');
const mini = r.json.models.find((m) => m.model_name === 'fake-mini');
r = await admin.req(B, 'PATCH', `/admin/models/${smart.id}`, { enabled: true, tags: ['smart', 'code'], display_name: 'EagleDocs Smart', supports_tools: true });
check('enable smart model', r.status === 200 && r.json.enabled);
await admin.req(B, 'PATCH', `/admin/models/${mini.id}`, { enabled: true, tags: ['fast'], display_name: 'EagleDocs Mini', supports_tools: true });
await admin.req(A, 'PATCH', '/admin/settings', { eagledocs_daily_messages: 0 });

r = await user.req(B, 'GET', '/models');
check('user sees EagleDocs models', r.status === 200 && r.json.filter((m) => m.provider === 'eagledocs').length === 2);

// ---------------------------------------------------------------- simple chat, stream on the other replica
r = await user.req(B, 'POST', '/chats', {});
const chatId = r.json.id;
r = await user.req(B, 'POST', `/chats/${chatId}/messages`, { content: 'hola', model_ref: 'auto' });
check('send message', r.status === 201 && r.json.job_id, JSON.stringify(r.json).slice(0, 120));
let jobId = r.json.job_id;
let events = await user.stream(A, chatId, jobId);
const done = events.at(-1);
check('stream on A finishes with done', done?.type === 'done', events.map((e) => e.type).join(','));
check('auto picked the fast model for "hola"', events.some((e) => e.type === 'model' && /Auto -> EagleDocs Mini/.test(e.model_label)), JSON.stringify(events.find((e) => e.type === 'model')));
check('answer text', done?.message?.content === 'echo: hola', done?.message?.content);
r = await user.req(A, 'GET', `/chats/${chatId}`);
check('chat has title and 2 visible messages', r.json.chat.title === 'hola' && r.json.messages.length === 2, JSON.stringify(r.json.chat));

// Reconnect with Last-Event-ID replays only what is after it.
const lastButOne = events.at(-2)._id;
const replay = await user.stream(B, chatId, jobId, () => {}, lastButOne);
check('Last-Event-ID resumes', replay.length === 1 && replay[0].type === 'done', replay.map((e) => e.type).join(','));

// ---------------------------------------------------------------- tool call
r = await user.req(A, 'POST', `/chats/${chatId}/messages`, { content: 'qué hora es [time] explain please', model_ref: 'auto' });
events = await user.stream(B, chatId, r.json.job_id);
check('tool call then answer', events.some((e) => e.type === 'tool_result' && e.call.name === 'time_now') && /tool said/.test(events.at(-1).message?.content ?? ''), events.at(-1).message?.content);
check('final message carries the tool card', events.at(-1).message?.tool_calls?.[0]?.status === 'done');
r = await user.req(A, 'GET', `/chats/${chatId}`);
check('tool steps hidden from the chat', r.json.messages.length === 4, String(r.json.messages.length));

// ---------------------------------------------------------------- memory tool
r = await user.req(A, 'POST', `/chats/${chatId}/messages`, { content: 'remember this [memory] explain', model_ref: 'auto' });
await user.stream(A, chatId, r.json.job_id);
r = await user.req(B, 'GET', '/memories');
check('agent saved it to USER.md', r.json.docs?.user.includes('Likes end-to-end tests'), JSON.stringify(r.json?.docs));
r = await user.req(B, 'PUT', '/memories/docs/soul', { content: 'You are Eagle, a calm study partner who answers in short steps.' });
check('the student edits SOUL.md', r.status === 200 && /calm study partner/.test(r.json.docs.soul));
r = await user.req(B, 'PUT', '/memories/docs/notes', { content: 'x'.repeat(r.json.limits.notes + 1) });
check('files keep their size limit', r.status === 400);
r = await user.req(B, 'PUT', '/memories/docs/password', { content: 'x' });
check('only the three files exist', r.status === 404);

// ---------------------------------------------------------------- steer mid-answer (job on one replica, steer sent to the other)
r = await user.req(B, 'POST', `/chats/${chatId}/messages`, { content: 'write a lot [slow] explain', model_ref: 'auto' });
jobId = r.json.job_id;
let steered = false;
events = await user.stream(A, chatId, jobId, async (e) => {
  if (e.type === 'delta' && !steered) {
    steered = true;
    const s = await user.req(B, 'POST', `/jobs/${jobId}/steer`, { content: 'only one line please' });
    check('steer accepted', s.status === 201, JSON.stringify(s.json));
  }
});
check('generation interrupted', events.some((e) => e.type === 'interrupted'), events.map((e) => e.type).slice(0, 12).join(','));
check('steer applied', events.some((e) => e.type === 'steer_applied' && e.content === 'only one line please'));
check('model answered the correction', events.at(-1).message?.content === 'corrected: only one line please', events.at(-1).message?.content);
r = await user.req(A, 'GET', `/chats/${chatId}`);
check('steer shows in the chat as a correction', r.json.messages.some((m) => m.steer && m.content === 'only one line please'));

// ---------------------------------------------------------------- cancel
r = await user.req(A, 'POST', `/chats/${chatId}/messages`, { content: 'again [slow] explain', model_ref: 'auto' });
jobId = r.json.job_id;
let cancelled = false;
events = await user.stream(B, chatId, jobId, async (e) => {
  if (e.type === 'delta' && !cancelled) {
    cancelled = true;
    await sleep(300);
    await user.req(A, 'POST', `/jobs/${jobId}/cancel`);
  }
});
check('cancel stops the job', events.some((e) => e.type === 'status' && e.status === 'cancelled') && events.at(-1).type === 'done', events.map((e) => e.type).slice(-3).join(','));
check('partial answer kept', /word0/.test(events.at(-1).message?.content ?? ''), (events.at(-1).message?.content ?? '').slice(0, 40));
r = await user.req(B, 'GET', '/jobs');
check('job list shows cancelled', r.json[0].status === 'cancelled', r.json[0].status);

// ---------------------------------------------------------------- at most 2 running jobs per student
const limitJobs = [];
for (let i = 0; i < 3; i++) {
  const c = (await user.req(A, 'POST', '/chats', {})).json.id;
  limitJobs.push((await user.req(A, 'POST', `/chats/${c}/messages`, { content: `limit ${i} [slow] explain`, model_ref: 'auto' })).json.job_id);
}
await sleep(3000);
r = await user.req(A, 'GET', '/jobs');
const limitStates = limitJobs.map((id) => r.json.find((j) => j.id === id)?.status);
check('a third job waits while two run', limitStates.filter((st) => st === 'running').length === 2 && limitStates.includes('queued'), limitStates.join(','));
for (const id of limitJobs) await user.req(A, 'POST', `/jobs/${id}/cancel`);
await sleep(1500);

// ---------------------------------------------------------------- delegation (waiting, then in the background)
r = await user.req(A, 'POST', '/chats', {});
const delegateChat = r.json.id;
r = await user.req(A, 'POST', `/chats/${delegateChat}/messages`, { content: 'split this [delegate] explain', model_ref: 'auto' });
events = await user.stream(B, delegateChat, r.json.job_id);
const helperSteps = events.filter((e) => e.type === 'subagent' && e.event.type === 'tool_result');
check('helpers report their steps live', helperSteps.some((e) => e.index === 0 && e.event.call.name === 'time_now'), events.map((e) => e.type).join(','));
const helperModelOf = (i) => events.find((e) => e.type === 'subagent' && e.index === i)?.model_label;
check('each helper runs on the model the agent picked', helperModelOf(0) === 'EagleDocs Mini' && helperModelOf(1) === 'EagleDocs Smart', `${helperModelOf(0)} / ${helperModelOf(1)}`);
check("helpers' tokens are not stored as events", !events.some((e) => e.type === 'subagent' && e.event.type === 'delta'));
check('waiting delegation answers with the reports', /tool said/.test(events.at(-1).message?.content ?? ''), events.at(-1).message?.content);

r = await user.req(A, 'POST', `/chats/${delegateChat}/messages`, { content: 'read everything [delegatebg] explain', model_ref: 'auto' });
events = await user.stream(B, delegateChat, r.json.job_id);
check('background delegation answers right away', /started/.test(events.at(-1).message?.content ?? ''), events.at(-1).message?.content);
r = await user.req(A, 'GET', '/jobs');
const delegateJob = r.json.find((j) => j.kind === 'delegate');
check('helpers run as their own job, listed under the chat', delegateJob?.chat_id === delegateChat, JSON.stringify(r.json[0]));
const helperEvents = await user.stream(A, delegateChat, delegateJob.id);
check('background job streams helper progress and ends', helperEvents.some((e) => e.type === 'subagent') && helperEvents.at(-1).type === 'done', helperEvents.map((e) => e.type).join(','));
let followUp;
for (let i = 0; i < 30 && !followUp; i++) {
  r = await user.req(A, 'GET', '/jobs');
  // Jobs come newest first: the turn queued after the helpers finished.
  const helpersAt = r.json.findIndex((j) => j.id === delegateJob.id);
  followUp = r.json.slice(0, helpersAt).find((j) => j.kind === 'chat' && j.chat_id === delegateChat);
  if (!followUp) await sleep(300);
}
check('a new turn answers with the reports', Boolean(followUp));
events = await user.stream(B, delegateChat, followUp.id);
check('reports enter the chat first', events.some((e) => e.type === 'background_results' && e.message.background?.tasks.length === 2), events.map((e) => e.type).join(','));
check('the agent answers with them', events.at(-1).message?.content === 'summary of 2 reports', events.at(-1).message?.content);
r = await user.req(A, 'GET', `/chats/${delegateChat}`);
const reportMessage = r.json.messages.find((m) => m.background);
check('saved chat keeps the report card and the answer', reportMessage && r.json.messages.at(-1).content === 'summary of 2 reports' && r.json.background_jobs.length === 0, JSON.stringify(r.json.background_jobs));
r = await user.req(A, 'POST', `/chats/${delegateChat}/messages`, { content: 'hola otra vez', model_ref: 'auto' });
check('chat is free again', r.status === 201);
await user.stream(A, delegateChat, r.json.job_id);

// ---------------------------------------------------------------- busy chat
r = await user.req(A, 'POST', `/chats/${chatId}/messages`, { content: 'long [slow] explain', model_ref: 'auto' });
const busyJob = r.json.job_id;
r = await user.req(B, 'POST', `/chats/${chatId}/messages`, { content: 'another', model_ref: 'auto' });
check('second message while busy is refused', r.status === 409, r.json?.error);
await user.req(A, 'POST', `/jobs/${busyJob}/cancel`);
await user.stream(A, chatId, busyJob);

// ---------------------------------------------------------------- daily quota
await admin.req(A, 'PATCH', '/admin/settings', { eagledocs_daily_messages: 1 });
await sleep(300);
r = await user.req(B, 'POST', '/chats', {});
const quotaChat = r.json.id;
r = await user.req(B, 'POST', `/chats/${quotaChat}/messages`, { content: 'hola', model_ref: 'auto' });
events = await user.stream(A, quotaChat, r.json.job_id);
check('quota reached gives a clear error', events.at(-1).type === 'error' && /today/i.test(events.at(-1).error), events.at(-1).error);
await admin.req(A, 'PATCH', '/admin/settings', { eagledocs_daily_messages: 0 });
await sleep(300);
// The failed turn runs again from the Tasks panel, without retyping it.
const failedJob = (await user.req(A, 'GET', '/jobs')).json.find((j) => j.chat_id === quotaChat && j.status === 'failed');
r = await user.req(A, 'POST', `/jobs/${failedJob?.id}/retry`);
check('a failed turn can run again', r.status === 201 && r.json.chat_id === quotaChat, JSON.stringify(r.json));
events = await user.stream(B, quotaChat, r.json.job_id);
check('the retry answers', events.at(-1).type === 'done', events.at(-1).error);
r = await user.req(A, 'GET', `/chats/${quotaChat}`);
check('the retry note stays hidden from the chat', !r.json.messages.some((m) => m.role === 'user' && /previous attempt/.test(m.content)), JSON.stringify(r.json.messages.map((m) => m.content.slice(0, 40))));
r = await user.req(A, 'POST', `/jobs/${limitJobs[0]}/retry`);
check('only stopped or failed turns can run again', r.status === 409, r.json?.error);

// ---------------------------------------------------------------- schedules
r = await user.req(A, 'POST', '/schedules', { name: 'Check', cron: '0 8 * * 1', prompt: 'Weekly check [SILENT]' });
check('create schedule', r.status === 201 && r.json.next_run_at, JSON.stringify(r.json));
r = await user.req(A, 'POST', '/schedules', { name: 'Bad', cron: 'every 5m', prompt: 'x' });
check('invalid schedule refused with reason', r.status === 400 && /15 minutes/.test(r.json.error), r.json?.error);

// ---------------------------------------------------------------- approvals endpoint and isolation
r = await admin.req(A, 'GET', `/chats/${chatId}`);
check("users cannot read each other's chats", r.status === 404);

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
