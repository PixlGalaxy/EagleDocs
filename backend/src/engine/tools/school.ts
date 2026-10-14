import { randomBytes } from 'node:crypto';
import { defineTool, type Tool, type ToolContext } from 'pixlai-engine';
import { SchoolError, type SchoolService } from '../../modules/school/school.service.js';
import type { DiskWorkspace } from '../workspace.js';

/** What the worker puts in `host.school` for each run. */
export interface SchoolHost {
  service: SchoolService;
  userId: string;
  workspace: DiskWorkspace;
}

const DRAFTS = 'Drafts/email';
/** School sign-in can wait up to 3 minutes for Duo on top of the page work. */
const SCHOOL_TIMEOUT_MS = 6 * 60_000;
const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

function schoolOf(ctx: ToolContext): SchoolHost {
  const host = ctx.host.school as SchoolHost | undefined;
  if (!host) throw new Error('School accounts are not available in this run');
  return host;
}

/** Sign-in problems as instructions the model can act on. */
async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!(err instanceof SchoolError)) throw err;
    const next: Record<SchoolError['reason'], string> = {
      not_connected: '',
      not_configured: '',
      unavailable: '',
      bad_credentials: ' Ask the student to update their school password in Settings > Connections.',
      blocked: ' Tell the student their school blocked this sign-in; they can use the website themselves.',
      mfa_timeout: ' Ask the student whether they want to try again (they will get a new Duo push).',
      stuck: ' Tell the student; do not keep retrying.',
    };
    throw new Error(`${err.message}${next[err.reason]}`);
  }
}

const step = (ctx: ToolContext) => ({ signal: ctx.signal, emit: ctx.emit });

export const emailInbox = defineTool<{ limit?: number }>({
  name: 'email_inbox',
  description:
    "The student's school inbox (Outlook): newest messages with sender, subject, date and preview, plus an id for " +
    'email_read. Signs in with their saved school account; if the school asks for Duo, the student approves it on their ' +
    'phone (tell them). Read-only.',
  parameters: { type: 'object', properties: { limit: { type: 'integer', description: 'Messages, 1-50 (default 20)' } } },
  sideEffect: 'none',
  untrusted: true,
  mainAgentOnly: true,
  timeoutMs: SCHOOL_TIMEOUT_MS,
  async run(args, ctx) {
    const { service, userId } = schoolOf(ctx);
    const limit = Math.min(50, Math.max(1, Number(args.limit) || 20));
    return call(() => service.inbox(userId, limit, step(ctx)));
  },
});

export const emailSearch = defineTool<{ query: string; limit?: number }>({
  name: 'email_search',
  description:
    "Search the student's school email (Outlook search: words, a sender, a course code like \"ACG 2021\", " +
    '"access code"...). Returns matching messages with an id for email_read. Read-only.',
  parameters: {
    type: 'object',
    properties: { query: { type: 'string' }, limit: { type: 'integer', description: 'Messages, 1-50 (default 20)' } },
    required: ['query'],
  },
  sideEffect: 'none',
  untrusted: true,
  mainAgentOnly: true,
  timeoutMs: SCHOOL_TIMEOUT_MS,
  async run(args, ctx) {
    const { service, userId } = schoolOf(ctx);
    const query = String(args.query ?? '').trim().slice(0, 200);
    if (!query) throw new Error('query is empty');
    const limit = Math.min(50, Math.max(1, Number(args.limit) || 20));
    return call(() => service.search(userId, query, limit, step(ctx)));
  },
});

export const emailRead = defineTool<{ id: string }>({
  name: 'email_read',
  description: 'Open one school email by the id from email_inbox or email_search and read it whole. Read-only.',
  parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  sideEffect: 'none',
  untrusted: true,
  mainAgentOnly: true,
  timeoutMs: SCHOOL_TIMEOUT_MS,
  async run(args, ctx) {
    const { service, userId } = schoolOf(ctx);
    return call(() => service.read(userId, String(args.id ?? ''), step(ctx)));
  },
});

interface Draft {
  id: string;
  to: string[];
  subject: string;
  body: string;
  created_at: string;
  sent_at?: string;
}

export const emailDraft = defineTool<{ to: string[]; subject: string; body: string }>({
  name: 'email_draft',
  description:
    `Write an email draft for the student (saved in their files under ${DRAFTS}/). Nothing is sent. Show them the ` +
    'draft (recipients, subject and body) and ask before sending it with email_send. Write it as the student, in their ' +
    'voice; never send graded work.',
  parameters: {
    type: 'object',
    properties: {
      to: { type: 'array', items: { type: 'string' }, description: 'Email addresses' },
      subject: { type: 'string' },
      body: { type: 'string', description: 'Plain text' },
    },
    required: ['to', 'subject', 'body'],
  },
  sideEffect: 'none',
  mainAgentOnly: true,
  async run(args, ctx) {
    const { workspace, userId } = schoolOf(ctx);
    const to = (Array.isArray(args.to) ? args.to : [args.to]).map((a) => String(a).trim()).filter(Boolean);
    if (to.length === 0 || to.length > 10 || !to.every((a) => EMAIL.test(a))) throw new Error('to: 1 to 10 valid email addresses');
    const subject = String(args.subject ?? '').trim().slice(0, 200);
    const body = String(args.body ?? '').slice(0, 20_000);
    if (!subject || !body.trim()) throw new Error('subject and body are required');
    const draft: Draft = { id: randomBytes(4).toString('hex'), to, subject, body, created_at: ctx.clock.now().toISOString() };
    await workspace.write(userId, `${DRAFTS}/${draft.id}.json`, JSON.stringify(draft, null, 2));
    return { draft_id: draft.id, saved: `${DRAFTS}/${draft.id}.json`, to, subject, body, next: 'Show this to the student and send it only if they say so.' };
  },
});

export const emailSend = defineTool<{ draft_id: string }>({
  name: 'email_send',
  description:
    'Send a draft made with email_draft from the student\'s school email (Outlook). The student must approve it in the ' +
    'app first. EagleDocs then checks Sent Items; if it cannot confirm, say so and do NOT send again.',
  parameters: { type: 'object', properties: { draft_id: { type: 'string' } }, required: ['draft_id'] },
  sideEffect: 'external',
  mainAgentOnly: true,
  timeoutMs: SCHOOL_TIMEOUT_MS,
  describe: (a) => ({ summary: `Send the email draft ${a.draft_id} from your school account`, details: { draft: String(a.draft_id) } }),
  async run(args, ctx) {
    const { service, userId, workspace } = schoolOf(ctx);
    const id = String(args.draft_id ?? '');
    if (!/^[0-9a-f]{8}$/.test(id)) throw new Error('draft_id: the id email_draft returned');
    const path = `${DRAFTS}/${id}.json`;
    const draft = JSON.parse((await workspace.read(userId, path).catch(() => Buffer.from('null'))).toString('utf8')) as Draft | null;
    if (!draft) throw new Error('That draft does not exist; write it again with email_draft');
    if (draft.sent_at) throw new Error(`This draft was already sent on ${draft.sent_at}; never send it twice`);
    const { verified } = await call(() => service.send(userId, draft, step(ctx)));
    // Marked as sent either way: a second send could duplicate the email.
    await workspace.write(userId, path, JSON.stringify({ ...draft, sent_at: ctx.clock.now().toISOString() }, null, 2));
    return verified
      ? { sent: true, verified_in_sent_items: true, to: draft.to, subject: draft.subject }
      : { sent: 'probably', verified_in_sent_items: false, note: 'Outlook accepted Send but the message did not show up in Sent Items yet. Tell the student to check; do not send again.' };
  },
});

export const degreeworksAudit = defineTool({
  name: 'degreeworks_audit',
  description:
    "Read the student's Degree Works audit (degree requirements, completed, in-progress and missing courses, " +
    'credits, GPA) and save it as text in their files. Use it to build degree maps and semester plans: Degree Works is ' +
    'the source of truth for requirements; keep "choose X from Y" groups as they are, and separate what the audit says ' +
    'from your assumptions. Signs in with their school account (may need Duo on their phone).',
  parameters: { type: 'object', properties: {} },
  sideEffect: 'none',
  untrusted: true,
  mainAgentOnly: true,
  timeoutMs: SCHOOL_TIMEOUT_MS,
  async run(_args, ctx) {
    const { service, userId, workspace } = schoolOf(ctx);
    const audit = await call(() => service.audit(userId, step(ctx)));
    const day = ctx.clock.now().toISOString().slice(0, 10);
    const path = `Degree Works/audit-${day}.txt`;
    await workspace.write(userId, path, `${audit.title}\n\n${audit.text}`);
    const limit = 14_000;
    return {
      saved: path,
      total_chars: audit.text.length,
      audit: audit.text.slice(0, limit),
      ...(audit.text.length > limit && { more: `The audit continues: read the rest with files_read("${path}", offset ${limit}).` }),
    };
  },
});

export const SCHOOL_TOOLS: Tool[] = [emailInbox, emailSearch, emailRead, emailDraft, emailSend, degreeworksAudit];
