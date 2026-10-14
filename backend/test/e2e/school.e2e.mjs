// Phase 4 end-to-end: school accounts through the sandbox browser (Microsoft-style sign-in, Duo, "stay signed in"),
// Outlook (inbox, search, read, draft, send with approval and Sent check) and Degree Works.
// Needs Docker with eagledocs-sandbox:dev, a dev backend on E2E_A, fake-llm.mjs on 4999 and fake-school.mjs on 4997.
const A = process.env.E2E_A ?? 'http://localhost:4000/api';
const LLM = process.env.E2E_LLM ?? 'http://localhost:4999/v1';
const SCHOOL_HOST = process.env.E2E_SCHOOL ?? 'http://localhost:4997';
// What the sandbox browser (inside Docker) uses to reach the fake school on this machine.
const SCHOOL = process.env.E2E_SCHOOL_FROM_SANDBOX ?? 'http://host.docker.internal:4997';
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
const result = (events, name) => events.filter((e) => e.type === 'tool_result' && e.call.name === name).at(-1)?.call;

const admin = await login('admin', 'admin');
const user = await login('user', 'user');

let r = await admin.req('POST', '/admin/models/endpoints', { kind: 'openai_compat', name: 'Fake GPU', base_url: LLM });
r = await admin.req('POST', `/admin/models/endpoints/${r.json.id}/discover`);
for (const m of r.json.models) await admin.req('PATCH', `/admin/models/${m.id}`, { enabled: true, tags: ['smart', 'fast'], supports_tools: true });
await admin.req('PATCH', '/admin/settings', { eagledocs_daily_messages: 0 });
const inst = (await admin.req('GET', '/admin/institutions')).json.find((i) => i.slug === 'dev-university');
r = await admin.req('PUT', `/admin/institutions/${inst.id}`, { ...inst, outlook_url: `${SCHOOL}/mail/`, degreeworks_url: `${SCHOOL}/dw/` });
check('institution has Outlook and Degree Works URLs', r.status === 200, r.json?.error);

const chat = (await user.req('POST', '/chats', {})).json;

// ---------------------------------------------------------------- no account yet
let events = await user.ask(chat.id, '[inbox]');
check('without a school account the agent is told to add one', /Settings > Connections/.test(result(events, 'email_inbox')?.result_preview ?? ''), result(events, 'email_inbox')?.result_preview);

// ---------------------------------------------------------------- wrong password
await user.req('PUT', '/connections/sso', { email: 'dev.student@uni.example', password: 'wrong-password' });
events = await user.ask(chat.id, '[inbox]');
const wrong = result(events, 'email_inbox');
check('wrong password: clear error, no loop', wrong?.status === 'error' && /password is wrong|rejected the saved password/.test(wrong.result_preview), wrong?.result_preview);
r = await user.req('GET', '/connections');
const ssoAfterWrong = (r.json.connections ?? r.json).find?.((c) => c.kind === 'sso');
check('connection marked as error', ssoAfterWrong?.status === 'error', JSON.stringify(ssoAfterWrong));
check('the password never reaches the chat', !JSON.stringify(events).includes('wrong-password'));

// ---------------------------------------------------------------- sign-in with Duo
await user.req('PUT', '/connections/sso', { email: 'dev.student@uni.example', password: 'correct-horse' });
let mfa = null;
let jobStatusDuringMfa = null;
events = await user.ask(chat.id, '[inbox]', async (e) => {
  if (e.type === 'mfa_required') {
    mfa = e;
    const chats = await user.req('GET', '/chats');
    jobStatusDuringMfa = JSON.stringify(chats.json).includes('waiting_mfa') ? 'waiting_mfa' : 'other';
    await fetch(`${SCHOOL_HOST}/__approve`, { method: 'POST' });
  }
});
check('Duo prompt reported to the student', mfa?.message && /phone/i.test(mfa.message), JSON.stringify(mfa));
check('status goes to waiting_mfa and back to running', events.some((e) => e.type === 'status' && e.status === 'waiting_mfa') && events.some((e, i) => i > events.findIndex((x) => x.status === 'waiting_mfa') && e.type === 'status' && e.status === 'running'));
const inbox = result(events, 'email_inbox');
check('inbox read after approval', inbox?.status === 'done' && /msg-1/.test(inbox.result_preview) && /exam 2 moved/.test(inbox.result_preview), inbox?.result_preview);
check('rows deduplicated and untrusted', (inbox?.result_preview.match(/"id": "msg-1"/g) ?? []).length === 1 && /untrusted_content/.test(inbox?.result_preview ?? ''));
r = await user.req('GET', '/connections');
check('connection marked ok after sign-in', (r.json.connections ?? r.json).find?.((c) => c.kind === 'sso')?.status === 'ok');

// The session cookie is kept: no second Duo.
mfa = null;
events = await user.ask(chat.id, '[mailsearch access code]', async (e) => {
  if (e.type === 'mfa_required') mfa = e;
});
const found = result(events, 'email_search');
check('search uses the saved session (no new Duo)', !mfa && found?.status === 'done', found?.result_preview);
check('search finds the access code email only', /msg-2/.test(found?.result_preview ?? '') && !/msg-1/.test(found?.result_preview ?? ''), found?.result_preview);

events = await user.ask(chat.id, '[mailread msg-1]');
const read = result(events, 'email_read');
check('read opens the message body', /Lutgert 2201/.test(read?.result_preview ?? ''), read?.result_preview);

// ---------------------------------------------------------------- draft and send
events = await user.ask(chat.id, '[draft]');
const draft = result(events, 'email_draft');
const draftId = /"draft_id": "([0-9a-f]{8})"/.exec(draft?.result_preview ?? '')?.[1];
check('draft saved in the workspace', draftId && /Drafts\/email/.test(draft.result_preview), draft?.result_preview);
let approval = null;
events = await user.ask(chat.id, `[send ${draftId}]`, async (e) => {
  if (e.type === 'approval_required') {
    approval = e.approval;
    await user.req('POST', `/approvals/${e.approval.id}/approve`);
  }
});
const sentResult = result(events, 'email_send');
check('sending asks the student first', approval?.tool_name === 'email_send', JSON.stringify(approval));
check('sent and verified in Sent Items', /"verified_in_sent_items": true/.test(sentResult?.result_preview ?? ''), sentResult?.result_preview);
const sentMail = await (await fetch(`${SCHOOL_HOST}/__sent`)).json();
check('the school got exactly one email with the draft', sentMail.length === 1 && sentMail[0].subject === 'E2E question about exam 2' && /still on Thursday/.test(sentMail[0].body), JSON.stringify(sentMail));
events = await user.ask(chat.id, `[send ${draftId}]`, async (e) => {
  if (e.type === 'approval_required') await user.req('POST', `/approvals/${e.approval.id}/approve`);
});
check('a draft is never sent twice', /already sent/.test(result(events, 'email_send')?.result_preview ?? ''), result(events, 'email_send')?.result_preview);

// ---------------------------------------------------------------- Degree Works
mfa = null;
events = await user.ask(chat.id, '[audit]', async (e) => {
  if (e.type === 'mfa_required') {
    mfa = e;
    await fetch(`${SCHOOL_HOST}/__approve`, { method: 'POST' });
  }
});
const audit = result(events, 'degreeworks_audit');
check('Degree Works signs in on its own profile (Duo again)', !!mfa);
check('audit read', audit?.status === 'done' && /GPA 3.42/.test(audit.result_preview), audit?.result_preview);
r = await user.req('GET', `/files?path=${encodeURIComponent('Degree Works')}`);
const auditFile = r.json.entries?.find((e) => /^audit-\d{4}-\d{2}-\d{2}\.txt$/.test(e.name));
check('audit saved in the student\'s files', !!auditFile, JSON.stringify(r.json.entries));
// The tool preview is cut for the UI; the saved file has everything.
r = await user.req('GET', `/files/download?path=${encodeURIComponent(auditFile?.path ?? '')}`);
check('collapsed requirement blocks were expanded', /ACG 2071 Managerial Accounting - STILL NEEDED/.test(r.raw) && /Choose 2 from/.test(r.raw), r.raw.slice(0, 200));
r = await user.req('GET', '/browser');
check('separate cookie profiles for mail and Degree Works', ['school-outlook', 'school-degreeworks'].every((p) => r.json.profiles.includes(p)), JSON.stringify(r.json.profiles));

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
