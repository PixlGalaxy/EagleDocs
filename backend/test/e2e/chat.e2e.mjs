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

// ---------------------------------------------------------------- admin sets up the StudyHawk model
let r = await admin.req(A, 'POST', '/admin/models/endpoints', { kind: 'openai_compat', name: 'Fake GPU', base_url: LLM });
check('create endpoint', r.status === 201, JSON.stringify(r.json).slice(0, 120));
const endpointId = r.json.id;
r = await admin.req(A, 'POST', `/admin/models/endpoints/${endpointId}/discover`);
check('discover models', r.status === 200 && r.json.models.length === 2, JSON.stringify(r.json).slice(0, 160));
const smart = r.json.models.find((m) => m.model_name === 'fake-smart');
const mini = r.json.models.find((m) => m.model_name === 'fake-mini');
r = await admin.req(B, 'PATCH', `/admin/models/${smart.id}`, { enabled: true, tags: ['smart', 'code'], display_name: 'StudyHawk Smart', supports_tools: true });
check('enable smart model', r.status === 200 && r.json.enabled);
await admin.req(B, 'PATCH', `/admin/models/${mini.id}`, { enabled: true, tags: ['fast'], display_name: 'StudyHawk Mini', supports_tools: true });
await admin.req(A, 'PATCH', '/admin/settings', { studyhawk_daily_messages: 0 });

r = await user.req(B, 'GET', '/models');
check('user sees StudyHawk models', r.status === 200 && r.json.filter((m) => m.provider === 'studyhawk').length === 2);

// ---------------------------------------------------------------- simple chat, stream on the other replica
r = await user.req(B, 'POST', '/chats', {});
const chatId = r.json.id;
r = await user.req(B, 'POST', `/chats/${chatId}/messages`, { content: 'hola', model_ref: 'auto' });
check('send message', r.status === 201 && r.json.job_id, JSON.stringify(r.json).slice(0, 120));
let jobId = r.json.job_id;
let events = await user.stream(A, chatId, jobId);
const done = events.at(-1);
check('stream on A finishes with done', done?.type === 'done', events.map((e) => e.type).join(','));
check('auto picked the fast model for "hola"', events.some((e) => e.type === 'model' && /Auto -> StudyHawk Mini/.test(e.model_label)), JSON.stringify(events.find((e) => e.type === 'model')));
check('answer text', done?.message?.content === 'echo: hola', done?.message?.content);
// The first words are the title at once; a quick model replaces them with a short name right after.
let titled = '';
for (let i = 0; i < 20 && titled !== 'Chat about hola'; i++) {
  titled = (await user.req(A, 'GET', `/chats/${chatId}`)).json.chat.title;
  if (titled !== 'Chat about hola') await new Promise((res) => setTimeout(res, 250));
}
r = await user.req(A, 'GET', `/chats/${chatId}`);
check('a quick model names the new chat (cleaned: no "Title:", quotes or period)', titled === 'Chat about hola' && r.json.messages.length === 2, JSON.stringify(r.json.chat));

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
r = await user.req(B, 'PUT', '/memories/docs/soul', { content: 'You are Hawk, a calm study partner who answers in short steps.' });
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

// ---------------------------------------------------------------- photos and files attached to a message
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const upload = async (name, bytes, type) => {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type }), name);
  const res = await fetch(`${A}/files/upload?path=${encodeURIComponent('TEMP/uploads/e2e')}`, { method: 'POST', headers: { cookie: user.headers('GET').cookie, 'x-csrf-token': decodeURIComponent(user.jar.csrf) }, body: form });
  return res.json();
};
await upload('board.png', PNG, 'image/png');
await upload('notes.txt', Buffer.from('Exam on Thursday'), 'text/plain');
const attachChat = (await user.req(A, 'POST', '/chats', {})).json.id;
r = await user.req(A, 'POST', `/chats/${attachChat}/messages`, { content: '[echoimages]', model_ref: 'auto', attachments: ['TEMP/uploads/e2e/board.png', 'TEMP/uploads/e2e/notes.txt'] });
check('a message can carry a photo and a file', r.status === 201 && r.json.message.attachments?.map((a) => a.kind).join(',') === 'image,file', JSON.stringify(r.json.message?.attachments));
// Uploads move into the chat's own folder, named after the chat.
const firstJob = r.json.job_id;
const [boardPath, notesPath] = r.json.message.attachments.map((a) => a.path);
const chatFolder = boardPath.slice(0, boardPath.lastIndexOf('/'));
check("uploads move into the chat's folder", /^Chats\/.+/.test(chatFolder) && notesPath === `${chatFolder}/notes.txt`, `${boardPath} ${notesPath}`);
r = await user.req(A, 'GET', `/files?path=${encodeURIComponent('TEMP/uploads/e2e')}`);
check('...and the staging folder they leave empty is removed', r.status === 404 || !(r.json.entries ?? []).length, JSON.stringify(r.json).slice(0, 120));
r = await user.req(A, 'GET', '/files?path=');
check('there is no "Chat uploads" folder', !(r.json.entries ?? []).some((e) => e.name === 'Chat uploads'), JSON.stringify((r.json.entries ?? []).map((e) => e.name)));
events = await user.stream(B, attachChat, firstJob);
let said = events.at(-1).message?.content ?? '';
check('a model without vision gets a note with the file path instead', /^images=0/.test(said) && said.includes(`Image attached: ${boardPath}`) && /notes\.txt \(file/.test(said), said);
check('the stream reports the context size', events.some((e) => e.type === 'context' && e.used > 0 && e.window > 0));
for (const m of [smart, mini]) await admin.req(A, 'PATCH', `/admin/models/${m.id}`, { supports_vision: true });
r = await user.req(A, 'POST', `/chats/${attachChat}/messages`, { content: '[echoimages]', model_ref: 'auto', attachments: [boardPath] });
events = await user.stream(B, attachChat, r.json.job_id);
said = events.at(-1).message?.content ?? '';
check('a vision model receives the picture itself', /^images=1/.test(said), said.slice(0, 120));
r = await user.req(A, 'POST', `/chats/${attachChat}/messages`, { content: '', model_ref: 'auto', attachments: [boardPath] });
check('a photo alone is a valid message', r.status === 201, r.json?.error);
check("a file already in the chat's folder stays where it is", r.json.message?.attachments?.[0]?.path === boardPath, r.json.message?.attachments?.[0]?.path);
await user.stream(B, attachChat, r.json.job_id);
r = await user.req(A, 'GET', `/chats/${attachChat}`);
check('the chat keeps the attachments and the last context size', r.json.messages[0]?.attachments?.length === 2 && r.json.context?.window > 0, JSON.stringify(r.json.context));
r = await user.req(A, 'POST', `/chats/${attachChat}/messages`, { content: 'x', model_ref: 'auto', attachments: ['../../etc/passwd'] });
check('attachments must be files in the student\'s workspace', r.status === 400, String(r.status));
let res = await fetch(`${A}/files/download?path=${encodeURIComponent(boardPath)}&inline=1`, { headers: { cookie: user.headers('GET').cookie } });
check('pictures preview inline, sandboxed', res.headers.get('content-type') === 'image/png' && /sandbox/.test(res.headers.get('content-security-policy') ?? '') && !/attachment/.test(res.headers.get('content-disposition') ?? ''), `${res.headers.get('content-type')} ${res.headers.get('content-disposition')}`);
res = await fetch(`${A}/files/download?path=${encodeURIComponent(notesPath)}&inline=1`, { headers: { cookie: user.headers('GET').cookie } });
check('other files always download', /attachment/.test(res.headers.get('content-disposition') ?? ''), res.headers.get('content-disposition'));
r = await user.req(A, 'PUT', '/files/content', { path: notesPath, content: 'Exam moved to Friday' });
res = await fetch(`${A}/files/download?path=${encodeURIComponent(notesPath)}`, { headers: { cookie: user.headers('GET').cookie } });
check('the workspace preview saves a text file', r.status === 200 && r.json.size === 20 && (await res.text()) === 'Exam moved to Friday', String(r.status));
r = await user.req(A, 'PUT', '/files/content', { path: boardPath, content: 'x' });
check('only text files can be saved as text', r.status === 400, String(r.status));
r = await user.req(A, 'PUT', '/files/content', { path: `${chatFolder}/new.md`, content: 'x' });
check('saving does not create files', r.status === 404, String(r.status));
// One file's details, for the chat's cards of the files an answer links to.
r = await user.req(A, 'GET', `/files/stat?path=${encodeURIComponent(notesPath)}`);
check("a file's details for its card", r.status === 200 && r.json.name === 'notes.txt' && r.json.type === 'file' && r.json.size > 0, JSON.stringify(r.json));
r = await user.req(A, 'GET', `/files/stat?path=${encodeURIComponent(`${chatFolder}/missing.pdf`)}`);
const missingStatus = r.status;
r = await admin.req(A, 'GET', `/files/stat?path=${encodeURIComponent(notesPath)}`);
check('a missing file, or one of another student, is not found', missingStatus === 404 && r.status === 404, `${missingStatus} ${r.status}`);
// Another chat gets its own folder; the same file name there does not clash.
await upload('board.png', PNG, 'image/png');
const otherChat = (await user.req(A, 'POST', '/chats', {})).json.id;
r = await user.req(A, 'POST', `/chats/${otherChat}/messages`, { content: 'second chat photo', model_ref: 'auto', attachments: ['TEMP/uploads/e2e/board.png'] });
const otherPath = r.json.message?.attachments?.[0]?.path ?? '';
check('each chat keeps its uploads in its own folder, named by its id', otherPath === `Chats/${otherChat}/board.png` && chatFolder === `Chats/${attachChat}`, otherPath);
await user.stream(B, otherChat, r.json.job_id);
// The Files views show those id folders by the chat's title.
r = await user.req(A, 'GET', `/files?path=Chats`);
const listedFolder = (r.json.entries ?? []).find((e) => e.name === otherChat);
check('the Chats folder lists each chat folder with its title', listedFolder?.type === 'dir' && typeof listedFolder.label === 'string' && listedFolder.label.length > 0, JSON.stringify(listedFolder));
// The chat's info card: its numbers and its folder's files.
r = await user.req(A, 'GET', `/chats/${otherChat}/info`);
check("a chat's info has its messages, tokens, models and files", r.status === 200 && r.json.messages === 1 && r.json.answers === 1 && r.json.tokens_in + r.json.tokens_out > 0 && r.json.models.length === 1 && r.json.files.count === 1 && r.json.folder === `Chats/${otherChat}`, JSON.stringify(r.json));
r = await admin.req(A, 'GET', `/chats/${otherChat}/info`);
check("nobody else can read a chat's info", r.status === 404, String(r.status));
// Deleting the chat deletes its folder.
r = await user.req(A, 'DELETE', `/chats/${otherChat}`);
r = await user.req(A, 'GET', `/files?path=Chats`);
check('deleting a chat deletes its folder', !(r.json.entries ?? []).some((e) => e.name === otherChat), JSON.stringify(r.json.entries?.map((e) => e.name)));
for (const m of [smart, mini]) await admin.req(A, 'PATCH', `/admin/models/${m.id}`, { supports_vision: false });

// ---------------------------------------------------------------- thinking level and compacting
r = await user.req(A, 'GET', '/models');
check('models say whether they take a thinking level', r.json.every((m) => typeof m.reasoning === 'boolean'), JSON.stringify(r.json.map((m) => m.reasoning)));
const thinkChat = (await user.req(A, 'POST', '/chats', {})).json.id;
r = await user.req(A, 'POST', `/chats/${thinkChat}/messages`, { content: '[echoreasoning]', model_ref: 'auto', reasoning: 'high' });
events = await user.stream(B, thinkChat, r.json.job_id);
check('the thinking level reaches the model', events.at(-1).message?.content === 'reasoning=high', events.at(-1).message?.content);
r = await user.req(A, 'POST', `/chats/${thinkChat}/messages`, { content: '[echoreasoning]', model_ref: 'auto', reasoning: 'bogus' });
events = await user.stream(B, thinkChat, r.json.job_id);
check('an unknown level falls back to the default', events.at(-1).message?.content === 'reasoning=default', events.at(-1).message?.content);
for (let i = 0; i < 7; i++) {
  r = await user.req(A, 'POST', `/chats/${thinkChat}/messages`, { content: `filler ${i}`, model_ref: 'auto' });
  await user.stream(B, thinkChat, r.json.job_id);
}
r = await user.req(A, 'POST', `/chats/${thinkChat}/compact`);
check('compacting summarizes the older messages', r.status === 200 && r.json.summarized > 0 && r.json.context?.window > 0, JSON.stringify(r.json));
const visible = (await user.req(A, 'GET', `/chats/${thinkChat}`)).json.messages.length;
r = await user.req(A, 'POST', `/chats/${thinkChat}/messages`, { content: '[echohistory]', model_ref: 'auto' });
events = await user.stream(B, thinkChat, r.json.job_id);
check('the model now reads the summary first and fewer turns', /summarized=true/.test(events.at(-1).message?.content ?? '') && Number(/turns=(\d+)/.exec(events.at(-1).message?.content ?? '')?.[1]) < visible, `${events.at(-1).message?.content} vs ${visible} visible`);
r = await user.req(A, 'GET', `/chats/${thinkChat}`);
check('the student still sees the whole conversation', r.json.messages.length === visible + 2, `${r.json.messages.length} vs ${visible + 2}`);

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
check('each helper runs on the model the agent picked', helperModelOf(0) === 'StudyHawk Mini' && helperModelOf(1) === 'StudyHawk Smart', `${helperModelOf(0)} / ${helperModelOf(1)}`);
check("helpers' tokens are not stored as events", !events.some((e) => e.type === 'subagent' && e.event.type === 'delta'));
check('waiting delegation answers with the reports', /tool said/.test(events.at(-1).message?.content ?? ''), events.at(-1).message?.content);
// The chat list: a finished answer nobody opened is unread, with the helpers of its delegation; opening it reads it.
let listed = (await user.req(A, 'GET', '/chats')).json.find((c) => c.id === delegateChat);
check('the list marks an answer not yet opened as unread, with its helpers', listed?.unread === true && listed.working === false && listed.helpers?.length === 2 && listed.helpers[0].goal === 'helper one [time]' && listed.helpers.every((h) => !h.running), JSON.stringify(listed));
await user.req(A, 'GET', `/chats/${delegateChat}`);
listed = (await user.req(A, 'GET', '/chats')).json.find((c) => c.id === delegateChat);
check('opening the chat reads it', listed?.unread === false, JSON.stringify(listed));

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

// ---------------------------------------------------------------- daily quota (from the student's plan)
const freePlan = (await admin.req(A, 'GET', '/admin/tiers')).json.find((t) => t.is_default);
await admin.req(A, 'PUT', `/admin/tiers/${freePlan.id}`, { daily_messages: 1 });
await sleep(300);
r = await user.req(B, 'POST', '/chats', {});
const quotaChat = r.json.id;
r = await user.req(B, 'POST', `/chats/${quotaChat}/messages`, { content: 'hola', model_ref: 'auto' });
events = await user.stream(A, quotaChat, r.json.job_id);
check('quota reached gives a clear error', events.at(-1).type === 'error' && /today/i.test(events.at(-1).error), events.at(-1).error);
await admin.req(A, 'PUT', `/admin/tiers/${freePlan.id}`, { daily_messages: 0 });
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

// ---------------------------------------------------------------- try again, with the same or another model
const retryChat = (await user.req(A, 'POST', '/chats', {})).json.id;
r = await user.req(A, 'POST', `/chats/${retryChat}/messages`, { content: 'say it again', model_ref: `studyhawk:${mini.id}` });
await user.stream(B, retryChat, r.json.job_id);
r = await user.req(A, 'POST', `/chats/${retryChat}/regenerate`, { model_ref: `studyhawk:${smart.id}` });
check('trying again queues a new answer', r.status === 201 && r.json.job_id, JSON.stringify(r.json));
events = await user.stream(B, retryChat, r.json.job_id);
r = await user.req(A, 'GET', `/chats/${retryChat}`);
const retried = r.json.messages;
check('the old answer is replaced, by the other model', retried.length === 2 && retried[1].role === 'assistant' && /Smart/.test(retried[1].model_label ?? '') && retried[1].content === 'echo: say it again', JSON.stringify(retried.map((m) => [m.role, m.model_label])));
r = await user.req(A, 'POST', `/chats/${retryChat}/regenerate`, {});
await user.stream(B, retryChat, r.json.job_id);
r = await user.req(A, 'GET', `/chats/${retryChat}`);
check("trying again with no model keeps the chat's model", r.json.messages.length === 2 && /Mini/.test(r.json.messages[1].model_label ?? ''), JSON.stringify(r.json.messages.map((m) => m.model_label)));
const emptyChat = (await user.req(A, 'POST', '/chats', {})).json.id;
r = await user.req(A, 'POST', `/chats/${emptyChat}/regenerate`, {});
const nothing = r.status;
r = await admin.req(A, 'POST', `/chats/${retryChat}/regenerate`, {});
check("nothing to try again, or another student's chat, is refused", nothing === 409 && r.status === 404, `${nothing} ${r.status}`);

// ---------------------------------------------------------------- forks
r = await user.req(A, 'GET', `/chats/${attachChat}`);
const original = r.json.messages;
const firstAnswer = original.find((m) => m.role === 'assistant');
r = await user.req(A, 'POST', `/chats/${attachChat}/fork`, { message_id: firstAnswer.id });
const fork1 = r.json;
check('a fork from an answer is a new chat under the original, numbered 1', r.status === 201 && fork1.parent_id === attachChat && fork1.fork_label === '1' && fork1.id !== attachChat, JSON.stringify(r.json).slice(0, 160));
r = await user.req(A, 'GET', `/chats/${fork1.id}`);
check('it has the conversation up to that answer (its file paths now in the fork folder)', r.json.messages.length === 2 && r.json.messages[1].content === firstAnswer.content.split(attachChat).join(fork1.id), r.json.messages[1]?.content?.slice(0, 160));
const forkedFile = r.json.messages[0].attachments?.[0]?.path ?? '';
check("its files are a copy in its own folder, and the messages point there", forkedFile.startsWith(`Chats/${fork1.id}/`), forkedFile);
r = await user.req(A, 'GET', `/files/stat?path=${encodeURIComponent(forkedFile)}`);
check('the copied file is there', r.status === 200, String(r.status));
r = await user.req(A, 'POST', `/chats/${attachChat}/fork`, {});
const fork2 = r.json;
r = await user.req(A, 'POST', `/chats/${fork1.id}/fork`, {});
const fork11 = r.json;
check('the next fork is 2, and a fork of fork 1 is 1.1', fork2.fork_label === '2' && fork11.fork_label === '1.1' && fork11.parent_id === fork1.id, `${fork2.fork_label} ${fork11.fork_label}`);
r = await user.req(A, 'POST', `/chats/${attachChat}/fork`, { message_id: original[0].id });
const fromUser = r.status;
r = await admin.req(A, 'POST', `/chats/${attachChat}/fork`, {});
check("a fork starts from an answer, and only the owner forks", fromUser === 409 && r.status === 404, `${fromUser} ${r.status}`);
// Deleting the original deletes every fork under it, with their folders.
await user.req(A, 'DELETE', `/chats/${attachChat}`);
const remaining = (await user.req(A, 'GET', '/chats')).json.map((c) => c.id);
const folders = ((await user.req(A, 'GET', '/files?path=Chats')).json.entries ?? []).map((e) => e.name);
check('deleting a chat deletes all its forks and their folders', ![attachChat, fork1.id, fork2.id, fork11.id].some((id) => remaining.includes(id) || folders.includes(id)), JSON.stringify(folders));

// ---------------------------------------------------------------- editing a message (versions, like ChatGPT)
const editChat = (await user.req(A, 'POST', '/chats', {})).json.id;
r = await user.req(A, 'POST', `/chats/${editChat}/messages`, { content: 'first question', model_ref: 'auto' });
await user.stream(B, editChat, r.json.job_id);
r = await user.req(A, 'POST', `/chats/${editChat}/messages`, { content: 'second question', model_ref: 'auto' });
await user.stream(B, editChat, r.json.job_id);
r = await user.req(A, 'GET', `/chats/${editChat}`);
const firstQuestion = r.json.messages[0];
r = await user.req(A, 'POST', `/chats/${editChat}/messages/${firstQuestion.id}/edit`, { content: 'first question, edited', model_ref: 'auto' });
check('editing a message answers it again', r.status === 201 && r.json.job_id, JSON.stringify(r.json));
await user.stream(B, editChat, r.json.job_id);
r = await user.req(A, 'GET', `/chats/${editChat}`);
let shownNow = r.json.messages;
check('the chat continues from the edited text, as version 2 of 2', shownNow.length === 2 && shownNow[0].content === 'first question, edited' && shownNow[0].version === 2 && shownNow[0].versions === 2 && shownNow[1].content === 'echo: first question, edited', JSON.stringify(shownNow.map((m) => [m.content, m.version, m.versions])));
r = await user.req(A, 'POST', `/chats/${editChat}/messages/${shownNow[0].id}/version`, { version: 1 });
check('switching versions', r.status === 204, String(r.status));
r = await user.req(A, 'GET', `/chats/${editChat}`);
shownNow = r.json.messages;
check('version 1 comes back with all that followed it', shownNow.length === 4 && shownNow[0].content === 'first question' && shownNow[0].version === 1 && shownNow[0].versions === 2 && shownNow[2].content === 'second question', JSON.stringify(shownNow.map((m) => m.content)));
const listedChats = (await user.req(A, 'GET', '/chats')).json;
check('hidden versions never show in the chat list', listedChats.filter((c) => c.title === listedChats.find((x) => x.id === editChat)?.title && c.id !== editChat).length === 0 && listedChats.some((c) => c.id === editChat), String(listedChats.length));
r = await admin.req(A, 'POST', `/chats/${editChat}/messages/${shownNow[0].id}/edit`, { content: 'not mine' });
check("nobody else can edit someone's message", r.status === 404, String(r.status));
r = await user.req(A, 'DELETE', `/chats/${editChat}`);
check('a chat with versions deletes', r.status === 204, String(r.status));

// ---------------------------------------------------------------- schedules
r = await user.req(A, 'POST', '/schedules', { name: 'Check', cron: '0 8 * * 1', prompt: 'Weekly check [SILENT]' });
check('create schedule', r.status === 201 && r.json.next_run_at, JSON.stringify(r.json));
r = await user.req(A, 'POST', '/schedules', { name: 'Bad', cron: 'every 5m', prompt: 'x' });
check('invalid schedule refused with reason', r.status === 400 && /15 minutes/.test(r.json.error), r.json?.error);

// ---------------------------------------------------------------- questions with options and pages in the chat
const askChat = (await user.req(A, 'POST', '/chats', {})).json.id;
r = await user.req(A, 'POST', `/chats/${askChat}/messages`, { content: 'help me study [askopts]', model_ref: 'auto' });
await user.stream(B, askChat, r.json.job_id);
r = await user.req(A, 'GET', `/chats/${askChat}`);
const asked = r.json.messages.at(-1);
check('the agent asks with options and the answer keeps them', asked?.questions?.length === 2 && asked.questions[1].multiSelect === true && /Which format/.test(asked.content), JSON.stringify(asked?.questions)?.slice(0, 160));
r = await user.req(A, 'POST', `/chats/${askChat}/messages`, { content: 'Format: Flashcards (Recommended)\nChapters: Ch 4, Ch 5 [html]', model_ref: 'auto' });
await user.stream(B, askChat, r.json.job_id);
r = await user.req(A, 'GET', `/chats/${askChat}`);
const shownMsg = r.json.messages.at(-1);
check('a page the agent shows is listed on its answer, without its HTML', shownMsg?.displays?.[0]?.title === 'Sine wave' && !JSON.stringify(shownMsg).includes('<canvas'), JSON.stringify(shownMsg?.displays));
let page = await fetch(`${A}/chats/${askChat}/messages/${shownMsg.id}/displays/0`, { headers: { cookie: user.headers('GET').cookie } });
const csp = page.headers.get('content-security-policy') ?? '';
check('the page is served on its own, sandboxed and without network', page.status === 200 && /text\/html/.test(page.headers.get('content-type') ?? '') && /sandbox allow-scripts/.test(csp) && /connect-src 'none'/.test(csp) && !/allow-same-origin/.test(csp) && (await page.text()).includes('<canvas'), csp);
page = await fetch(`${A}/chats/${askChat}/messages/${shownMsg.id}/displays/0`, { headers: { cookie: admin.headers('GET').cookie } });
check("another user cannot open someone's page", page.status === 404, String(page.status));
page = await fetch(`${A}/chats/${askChat}/messages/${shownMsg.id}/displays/5`, { headers: { cookie: user.headers('GET').cookie } });
check('a page that does not exist is 404', page.status === 404, String(page.status));

// ---------------------------------------------------------------- approvals endpoint and isolation
r = await admin.req(A, 'GET', `/chats/${chatId}`);
check("users cannot read each other's chats", r.status === 404);

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
