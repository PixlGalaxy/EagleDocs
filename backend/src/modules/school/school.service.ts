import type { EngineEvent } from 'pixlai-engine';
import type { Db } from '../../db/pool.js';
import { maybe } from '../../db/pool.js';
import { logger } from '../../logger.js';
import type { SandboxTools } from '../../engine/sandbox.js';
import type { ConnectionsService } from '../connections/connections.service.js';

export type SchoolApp = 'outlook' | 'degreeworks';

const DEFAULT_OUTLOOK = 'https://outlook.office.com/mail/';
const OUTLOOK_HOSTS = ['outlook.office.com', 'outlook.office365.com', 'outlook.cloud.microsoft', 'outlook.live.com'];
/** How long a Duo push may wait for the student. */
const MFA_WAIT_MS = 3 * 60_000;
const MAX_STEPS = 40;
/** The page changed while we were reading it (a redirect in the middle of a sign-in). */
const NAVIGATING = /execution context was destroyed|navigation|frame was detached|target closed/i;

/** A sign-in that cannot go on, with a message the model can relay. */
export class SchoolError extends Error {
  constructor(
    public reason: 'not_connected' | 'not_configured' | 'bad_credentials' | 'blocked' | 'mfa_timeout' | 'stuck' | 'unavailable' | 'compose',
    message: string,
  ) {
    super(message);
  }
}

/** Microsoft's own sign-in pages (school accounts on Microsoft 365). */
const MICROSOFT_LOGIN_HOSTS = ['login.microsoftonline.com', 'login.microsoft.com', 'login.live.com', 'login.windows.net', 'account.live.com'];
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', 'host.docker.internal']);
/** Second-level labels that are public suffixes in many countries (ac.uk, edu.pe, com.mx). */
const SECOND_LEVEL = new Set(['ac', 'co', 'com', 'edu', 'gov', 'net', 'org', 'sch']);

interface Account {
  email: string;
  username: string | null;
  password: string;
}

interface StepContext {
  signal: AbortSignal;
  emit: (event: EngineEvent) => void;
}

/** What the page in front of us is, decided inside the page (see DETECT). */
interface PageState {
  kind: 'target' | 'signed_out' | 'pick_account' | 'email' | 'password' | 'username_password' | 'kmsi' | 'duo_choose' | 'duo_trust' | 'mfa' | 'bad_credentials' | 'blocked' | 'unknown';
  detail?: string;
  title?: string;
  host?: string;
  /** The page was loaded over https (the saved password is never typed into anything else). */
  https?: boolean;
}

/**
 * Runs in the page. Recognizes the steps of a school sign-in: Microsoft Entra
 * (email, password, "stay signed in?"), Duo (choose push, waiting, trust this
 * browser), generic SSO forms (username + password), errors and policy blocks,
 * and the service itself (`arg` is its hostname).
 */
const DETECT = `
const visible = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
const find = (sel) => [...document.querySelectorAll(sel)].find(visible);
const text = (document.body ? document.body.innerText : '').slice(0, 6000);
const host = location.hostname.toLowerCase();
const out = (kind, detail) => ({ kind, detail, title: document.title, host, https: location.protocol === 'https:' });

if (/(^|\\.)duosecurity\\.com$/.test(host) || /duo/i.test(document.title)) {
  if (/is this your device|trust this browser|remember this device/i.test(text)) return out('duo_trust');
  if (/incorrect|denied|timed out|expired/i.test(text) && !/check for a duo push|sent to/i.test(text)) return out('mfa', 'retry');
  if (/check for a duo push|push sent|pushed a login|waiting for|sent to your device|verify it'?s you/i.test(text)) return out('mfa');
  if (/send (me a )?push|duo push/i.test(text)) return out('duo_choose');
  return out('mfa');
}
if (/AADSTS53003|cannot access this right now|conditional access|blocked by your (organization|admin)/i.test(text)) return out('blocked', text.slice(0, 200));
if (find('#usernameError, #passwordError, #errorText') || /account or password is incorrect|incorrect (user ?name|password)|invalid (user ?name|password|credentials)|username may be incorrect|login failed/i.test(text)) {
  return out('bad_credentials');
}
const password = find('input[type="password"]');
const loginfmt = find('input[name="loginfmt"], input[type="email"]');
if (find('#KmsiCheckboxField') || /stay signed in\\?/i.test(text)) return out('kmsi');
if (/approve sign.?in request|enter the number|authenticator app|verify your identity/i.test(text) && !password) return out('mfa', 'microsoft');
// Microsoft's "Sign out" page (an expired session ends here) leads nowhere: open the service again.
if (/^sign(ed)? out$/i.test(document.title.trim()) || /you signed out of your account|you have (been )?signed out/i.test(text)) return out('signed_out');
// Microsoft "Pick an account": a tile per remembered account.
if (/(^|\\.)(microsoftonline|live|microsoft)\\.com$/.test(host) && (/pick an account|choose an account/i.test(text) || find('#tilesHolder'))) return out('pick_account');
// Microsoft's first page already carries a (hidden or prefilled) password box: the email box decides.
if (/(^|\\.)(microsoftonline|live|microsoft)\\.com$/.test(host) && find('input[name="loginfmt"]') && !(find('input[name="passwd"]') || {}).value && /sign in|enter your email|email, phone/i.test(text) && !/enter password/i.test(text)) {
  return out('email');
}
const onTarget = (Array.isArray(arg) ? arg : [arg]).some((t) => t && (host === t || host.endsWith('.' + t)));
if (onTarget && !password && !loginfmt) return out('target');
if (password) {
  const user = find('input[type="email"], input[type="text"][name*="user" i], input[name="username"], input[name="j_username"], input[id*="user" i]');
  return out(user && !user.value ? 'username_password' : 'password');
}
if (loginfmt) return out('email');
return out('unknown', text.replace(/\\s+/g, ' ').trim().slice(0, 400));
`;

/** Outlook's message list, deduplicated (its accessibility wrappers repeat rows). */
const OUTLOOK_ROWS = `
const seen = new Set();
const rows = [];
for (const el of document.querySelectorAll('[data-convid]')) {
  const id = el.getAttribute('data-convid');
  if (!id || seen.has(id)) continue;
  seen.add(id);
  const label = el.getAttribute('aria-label') || '';
  const lines = (el.innerText || '').split('\\n').map((l) => l.trim()).filter(Boolean);
  rows.push({ id, unread: /unread/i.test(label), summary: (lines.join(' | ') || label).slice(0, 400) });
  if (rows.length >= (arg || 25)) break;
}
return rows;
`;

const OUTLOOK_READING_PANE = `
const pane = document.querySelector('[aria-label="Reading Pane"]') || document.querySelector('[role="main"]') || document.body;
return (pane.innerText || '').replace(/\\n{3,}/g, '\\n\\n').slice(0, 30000);
`;

const SEND_READY = `
const b = document.querySelector('[data-testid="ComposeSendButton"] button') || document.querySelector('button[aria-label="Send"]');
return b ? b.getAttribute('aria-disabled') !== 'true' && !b.disabled : null;
`;

const PAGE_TEXT = `
const main = document.querySelector('main') || document.querySelector('[role="main"]') || document.body;
return { title: document.title, text: (main.innerText || '').replace(/\\n{3,}/g, '\\n\\n') };
`;

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (clearTimeout(timer), reject(new Error('cancelled'))), { once: true });
  });

/**
 * The student's school accounts through their sandbox browser: signs in with
 * the saved SSO account (Microsoft Entra, Duo, generic SSO forms), then reads
 * Outlook Web and Degree Works. Each service keeps its own cookie profile, so a
 * login survives until the school expires it. The password goes from the
 * database straight into the page; the model never sees it.
 */
export class SchoolService {
  constructor(
    private db: Db,
    private connections: ConnectionsService,
    private browser: SandboxTools | undefined,
    /** Tells the student (web push) that the Settings test waits on Duo. */
    private onTestMfa?: (userId: string, message: string) => Promise<void>,
  ) {}

  private tools(): SandboxTools {
    if (!this.browser) throw new SchoolError('unavailable', 'The browser is not available on this server, so school accounts cannot be used.');
    return this.browser;
  }

  /**
   * Where the saved school password may be typed: Microsoft's sign-in, the
   * school's own domains (their SSO page), the service being opened and the
   * institution's SSO login URL. Any other page with a password box (a look-alike
   * reached through a redirect, or a wrong URL in the admin panel) gets nothing.
   */
  private async passwordHosts(userId: string, targetHosts: string[]): Promise<string[]> {
    const row = await maybe<{ sso_login_url: string | null; domains: string[] | null }>(
      this.db,
      `SELECT i.sso_login_url, array_agg(d.domain::text) FILTER (WHERE d.domain IS NOT NULL) AS domains
         FROM users u LEFT JOIN institutions i ON i.id = u.institution_id LEFT JOIN institution_domains d ON d.institution_id = i.id
        WHERE u.id = $1 GROUP BY i.sso_login_url`,
      [userId],
    );
    const hosts = new Set([...MICROSOFT_LOGIN_HOSTS, ...targetHosts]);
    for (const domain of row?.domains ?? []) {
      const d = domain.toLowerCase();
      hosts.add(d);
      // eagle.fgcu.edu signs in at login.fgcu.edu: the parent domain too, unless that is a public suffix (ac.uk).
      const labels = d.split('.');
      if (labels.length > 2 && !SECOND_LEVEL.has(labels.at(-2)!)) hosts.add(labels.slice(1).join('.'));
    }
    if (row?.sso_login_url && URL.canParse(row.sso_login_url)) hosts.add(new URL(row.sso_login_url).hostname.toLowerCase());
    return [...hosts];
  }

  private async account(userId: string): Promise<{ account: Account; connectionId: string }> {
    const row = await maybe<Parameters<ConnectionsService['secretOf']>[0]>(this.db, `SELECT * FROM connections WHERE user_id = $1 AND kind = 'sso'`, [userId]);
    if (!row?.secret_enc) {
      throw new SchoolError('not_connected', 'No school account is saved. Ask the student to add it in Settings > Connections > School account.');
    }
    return { account: JSON.parse(this.connections.secretOf(row)) as Account, connectionId: row.id };
  }

  async urls(userId: string): Promise<{ outlook: string; degreeworks: string | null }> {
    const row = await maybe<{ outlook_url: string | null; degreeworks_url: string | null }>(
      this.db,
      'SELECT i.outlook_url, i.degreeworks_url FROM users u LEFT JOIN institutions i ON i.id = u.institution_id WHERE u.id = $1',
      [userId],
    );
    return { outlook: row?.outlook_url || DEFAULT_OUTLOOK, degreeworks: row?.degreeworks_url ?? null };
  }

  private async run<T>(userId: string, step: string, body: Record<string, unknown>, signal: AbortSignal): Promise<T> {
    // Reading a page that is redirecting fails ("execution context was destroyed"): wait for it and read again.
    // Only reads are retried; a click or a fill is never repeated.
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.tools().runner<T>(userId, `/browser/${step}`, body, signal);
      } catch (err) {
        if (step !== 'eval' || attempt >= 4 || !NAVIGATING.test((err as Error).message)) throw err;
        await this.tools().runner(userId, '/browser/wait', { profile: body.profile, ms: 1500 }, signal);
      }
    }
  }

  private async detect(userId: string, profile: string, targetHosts: string[], signal: AbortSignal): Promise<PageState> {
    const res = await this.run<{ result: PageState }>(userId, 'eval', { profile, script: DETECT, arg: targetHosts }, signal);
    return res.result ?? { kind: 'unknown' };
  }

  /**
   * Opens `url` in the service's profile and signs in when the school asks.
   * While a Duo push waits, the run reports `mfa_required` / `waiting_mfa`.
   */
  async open(userId: string, service: SchoolApp, url: string, ctx: StepContext): Promise<void> {
    const profile = `school-${service}`;
    const host = new URL(url).hostname.toLowerCase();
    // Microsoft moves Outlook Web between domains (outlook.office.com, outlook.cloud.microsoft...).
    const targetHosts = OUTLOOK_HOSTS.includes(host) ? OUTLOOK_HOSTS : [host];
    await this.run(userId, 'goto', { profile, url }, ctx.signal);

    let account: Account | null = null;
    let connectionId: string | null = null;
    const credentials = async () => {
      if (!account) ({ account, connectionId } = await this.account(userId));
      return account!;
    };
    let passwordHosts: string[] | null = null;
    const assertPasswordHost = async (state: PageState) => {
      passwordHosts ??= await this.passwordHosts(userId, targetHosts);
      const at = (state.host ?? '').toLowerCase();
      // Plain http only for the local fake school of the e2e, never in production.
      const secure = state.https || (process.env.NODE_ENV !== 'production' && LOCAL_HOSTS.has(at));
      if (secure && passwordHosts.some((h) => at === h || at.endsWith(`.${h}`))) return;
      logger.warn(`School sign-in for ${userId}: refused to type the password at ${at || '?'} (not a known sign-in page)`);
      throw new SchoolError('stuck', `The sign-in went to ${at || 'an unknown page'}, which is not your school's or Microsoft's sign-in, so StudyHawk did not type your password there.`);
    };
    let mfaSince = 0;
    let unknownStreak = 0;
    let typedPassword = 0;
    let reopened = 0;
    const doneWaiting = () => {
      if (mfaSince) {
        ctx.emit({ type: 'status', status: 'running' });
        mfaSince = 0;
      }
    };

    for (let step = 0; step < MAX_STEPS; step++) {
      const state = await this.detect(userId, profile, targetHosts, ctx.signal);
      // Step trail for diagnosing real sign-in pages (page kind and host only, never values).
      logger.info(`School sign-in (${service}) step ${step}: ${state.kind} at ${state.host ?? "?"} "${(state.title ?? "").slice(0, 60)}"`);
      if (state.kind !== 'unknown') unknownStreak = 0;
      switch (state.kind) {
        case 'target':
          doneWaiting();
          if (connectionId) await this.db.query(`UPDATE connections SET status = 'ok', last_ok_at = now(), last_error = NULL WHERE id = $1`, [connectionId]);
          return;
        case 'signed_out':
          if (++reopened > 2) throw new SchoolError('stuck', 'The school keeps signing StudyHawk out.');
          await this.run(userId, 'goto', { profile, url }, ctx.signal);
          continue;
        case 'pick_account': {
          // Our account's tile when Microsoft lists it, otherwise "Use another account" (then the email step).
          // Quoted for the selector: a quote or backslash in the address must not change it.
          const email = (await credentials()).email.replace(/[\\"]/g, '\\$&');
          await this.run(userId, 'tap', { profile, selector: `[data-test-id="${email}"], div[role="button"]:has-text("${email}"), div[role="listitem"]:has-text("${email}")` }, ctx.signal).catch(() =>
            this.run(userId, 'tap', { profile, selector: '#otherTile, div[role="button"]:has-text("Use another account")' }, ctx.signal),
          );
          break;
        }
        case 'email':
          await this.run(userId, 'fill', { profile, selector: 'input[name="loginfmt"], input[type="email"]', value: (await credentials()).email, submit: true }, ctx.signal);
          break;
        case 'password':
        case 'username_password': {
          // The same password refused twice means it is wrong; never loop on it.
          if (++typedPassword > 2) throw await this.fail(connectionId, new SchoolError('bad_credentials', 'The school rejected the saved password.'));
          await assertPasswordHost(state);
          const acct = await credentials();
          if (state.kind === 'username_password') {
            await this.run(
              userId,
              'fill',
              { profile, selector: 'input[type="email"], input[type="text"][name*="user" i], input[name="username"], input[name="j_username"], input[id*="user" i]', value: acct.username ?? acct.email },
              ctx.signal,
            );
          }
          await this.run(userId, 'fill', { profile, selector: 'input[type="password"]', value: acct.password, submit: true }, ctx.signal);
          break;
        }
        case 'kmsi':
          // "Stay signed in?" yes: longer-lived cookies, fewer Duo prompts.
          await this.run(userId, 'tap', { profile, selector: '#idSIButton9, input[type="submit"][value="Yes"], button:has-text("Yes")' }, ctx.signal).catch(() => undefined);
          break;
        case 'duo_choose':
          await this.run(userId, 'tap', { profile, selector: 'button:has-text("Send me a Push"), button:has-text("Send Push"), button:has-text("Duo Push")' }, ctx.signal).catch(() => undefined);
          break;
        case 'duo_trust':
          await this.run(userId, 'tap', { profile, selector: '#trust-browser-button, button:has-text("Yes, this is my device"), button:has-text("Trust browser")' }, ctx.signal).catch(() => undefined);
          break;
        case 'mfa': {
          if (!mfaSince) {
            mfaSince = Date.now();
            const service_ = service === 'outlook' ? 'school email' : 'Degree Works';
            ctx.emit({ type: 'mfa_required', service, message: `Approve the sign-in on your phone (Duo) so StudyHawk can open your ${service_}.` });
            ctx.emit({ type: 'status', status: 'waiting_mfa' });
          }
          if (Date.now() - mfaSince > MFA_WAIT_MS) {
            doneWaiting();
            throw new SchoolError('mfa_timeout', 'The sign-in approval (Duo) was not answered within 3 minutes.');
          }
          await sleep(3000, ctx.signal);
          continue;
        }
        case 'bad_credentials':
          doneWaiting();
          throw await this.fail(connectionId, new SchoolError('bad_credentials', 'The school said the saved username or password is wrong.'));
        case 'blocked':
          doneWaiting();
          throw await this.fail(connectionId, new SchoolError('blocked', 'The school blocked this sign-in by policy (not a password problem).'));
        case 'unknown':
          // An interstitial page we do not know: opening the service again often gets past it.
          if (++unknownStreak === 3 && reopened < 2) {
            reopened++;
            await this.run(userId, 'goto', { profile, url }, ctx.signal);
            continue;
          }
          if (unknownStreak > 6) {
            doneWaiting();
            logger.warn(`School sign-in stuck for ${userId} on ${state.host}: ${state.title}`);
            // What the page says, so the agent can tell the student (e.g. a notice from the school). Page text, not instructions.
            const says = state.detail ? ` The page says: "${state.detail.replace(/"/g, "'")}"` : '';
            throw new SchoolError('stuck', `The sign-in stopped at a page StudyHawk does not recognize ("${state.title ?? state.host}" at ${state.host}).${says}`);
          }
          break;
      }
      await this.run(userId, 'wait', { profile, ms: 1500 }, ctx.signal);
    }
    throw new SchoolError('stuck', 'The sign-in took too many steps.');
  }

  /**
   * Settings "Test": opens the school email the way the agent does, signing in
   * (with Duo when the school asks) only if the saved session expired. Runs in
   * the background; the connection row shows progress (meta.testing,
   * waiting_mfa) and ends as ok or error with the reason.
   */
  async testSignIn(userId: string): Promise<void> {
    const { connectionId } = await this.account(userId);
    const claimed = await this.db.query(
      // A test left behind by a restart counts as over after a few minutes.
      `UPDATE connections SET meta = meta || jsonb_build_object('testing', now()::text), last_error = NULL, updated_at = now()
       WHERE id = $1 AND (NOT meta ? 'testing' OR (meta->>'testing')::timestamptz < now() - interval '6 minutes') RETURNING id`,
      [connectionId],
    );
    if (!claimed.rowCount) return; // A test is already running.
    const ctx: StepContext = {
      signal: AbortSignal.timeout(MFA_WAIT_MS + 2 * 60_000),
      emit: (event) => {
        if (event.type === 'mfa_required') void this.onTestMfa?.(userId, event.message).catch(() => undefined);
        if (event.type === 'status' && (event.status === 'waiting_mfa' || event.status === 'running')) {
          void this.db
            .query(`UPDATE connections SET status = $2 WHERE id = $1`, [connectionId, event.status === 'waiting_mfa' ? 'waiting_mfa' : 'untested'])
            .catch(() => undefined);
        }
      },
    };
    void (async () => {
      try {
        await this.open(userId, 'outlook', (await this.urls(userId)).outlook, ctx);
        await this.db.query(`UPDATE connections SET status = 'ok', last_ok_at = now(), last_error = NULL WHERE id = $1`, [connectionId]);
      } catch (err) {
        const message = err instanceof SchoolError ? err.message : `The test could not finish: ${(err as Error).message}`;
        await this.db.query(`UPDATE connections SET status = 'error', last_error = $2 WHERE id = $1`, [connectionId, message]).catch(() => undefined);
      } finally {
        await this.db.query(`UPDATE connections SET meta = meta - 'testing' WHERE id = $1`, [connectionId]).catch(() => undefined);
      }
    })();
  }

  private async fail(connectionId: string | null, err: SchoolError): Promise<SchoolError> {
    if (connectionId) await this.db.query(`UPDATE connections SET status = 'error', last_error = $2 WHERE id = $1`, [connectionId, err.message]);
    return err;
  }

  // ---------------------------------------------------------------- Outlook

  private async outlook(userId: string, ctx: StepContext, path = ''): Promise<string> {
    const base = (await this.urls(userId)).outlook.replace(/\/+$/, '');
    await this.open(userId, 'outlook', `${base}${path}`, ctx);
    // Outlook Web is a heavy app: give the list time to render.
    await this.run(userId, 'wait', { profile: 'school-outlook', ms: 2500 }, ctx.signal);
    return base;
  }

  async inbox(userId: string, limit: number, ctx: StepContext) {
    await this.outlook(userId, ctx);
    const res = await this.run<{ result: unknown[] }>(userId, 'eval', { profile: 'school-outlook', script: OUTLOOK_ROWS, arg: limit }, ctx.signal);
    return res.result ?? [];
  }

  async search(userId: string, query: string, limit: number, ctx: StepContext) {
    await this.outlook(userId, ctx);
    await this.run(
      userId,
      'fill',
      { profile: 'school-outlook', selector: '#topSearchInput, input[aria-label*="Search" i], input[placeholder*="Search" i]', value: query, submit: true },
      ctx.signal,
    );
    await this.run(userId, 'wait', { profile: 'school-outlook', ms: 3500 }, ctx.signal);
    const res = await this.run<{ result: unknown[] }>(userId, 'eval', { profile: 'school-outlook', script: OUTLOOK_ROWS, arg: limit }, ctx.signal);
    return res.result ?? [];
  }

  async read(userId: string, id: string, ctx: StepContext): Promise<string> {
    if (!/^[A-Za-z0-9+/=_-]{4,400}$/.test(id)) throw new Error('Invalid message id: use an id from email_inbox or email_search');
    await this.outlook(userId, ctx);
    await this.run(userId, 'tap', { profile: 'school-outlook', selector: `[data-convid="${id}"]` }, ctx.signal).catch(() => {
      throw new Error('That message is not in the current list: search for it first with email_search');
    });
    await this.run(userId, 'wait', { profile: 'school-outlook', ms: 2500 }, ctx.signal);
    return (await this.run<{ result: string }>(userId, 'eval', { profile: 'school-outlook', script: OUTLOOK_READING_PANE }, ctx.signal)).result ?? '';
  }

  /** Sends through Outlook Web, then looks for it in Sent Items. Never retried blindly. */
  async send(userId: string, draft: { to: string[]; subject: string; body: string }, ctx: StepContext): Promise<{ verified: boolean }> {
    const base = await this.outlook(userId, ctx);
    const p = 'school-outlook';
    await this.run(userId, 'tap', { profile: p, selector: 'button[aria-label="New mail"], button[aria-label="New"]' }, ctx.signal);
    await this.run(userId, 'wait', { profile: p, ms: 2000 }, ctx.signal);
    // Outlook's recipient picker only turns typed addresses into recipients (pasting is ignored).
    for (const address of draft.to) {
      await this.run(userId, 'type', { profile: p, selector: 'div[aria-label="To"], input[aria-label="To"]', value: address }, ctx.signal);
      // Outlook looks the address up in the directory first; Enter before that leaves plain text, not a recipient.
      await this.run(userId, 'wait', { profile: p, ms: 2500 }, ctx.signal);
      await this.run(userId, 'act', { profile: p, action: { kind: 'press', key: 'Enter' } }, ctx.signal);
      await this.run(userId, 'wait', { profile: p, ms: 1000 }, ctx.signal);
    }
    await this.run(userId, 'fill', { profile: p, selector: 'input[aria-label="Subject"], input[placeholder="Add a subject"], input[aria-label="Add a subject"]', value: draft.subject }, ctx.signal);
    await this.run(userId, 'fill', { profile: p, selector: 'div[aria-label="Message body"][contenteditable="true"], div[role="textbox"][contenteditable="true"]', value: draft.body }, ctx.signal);
    // Send stays disabled until Outlook accepted every recipient: say so instead of waiting on a dead button.
    const ready = (await this.run<{ result: boolean | null }>(userId, 'eval', { profile: p, script: SEND_READY }, ctx.signal)).result;
    if (ready === false) {
      throw new SchoolError('compose', `Outlook did not accept the recipient (${draft.to.join(', ')}), so Send stayed disabled. Nothing was sent; the unsent message may be in Outlook's Drafts.`);
    }
    await this.run(userId, 'tap', { profile: p, selector: '[data-testid="ComposeSendButton"] button, button[aria-label="Send"]' }, ctx.signal);
    await this.run(userId, 'wait', { profile: p, ms: 5000 }, ctx.signal);
    // Verify in Sent Items.
    await this.run(userId, 'goto', { profile: p, url: `${base}/sentitems` }, ctx.signal);
    await this.run(userId, 'wait', { profile: p, ms: 3000 }, ctx.signal);
    const rows = (await this.run<{ result: { summary: string }[] }>(userId, 'eval', { profile: p, script: OUTLOOK_ROWS, arg: 15 }, ctx.signal)).result ?? [];
    return { verified: rows.some((r) => r.summary.toLowerCase().includes(draft.subject.toLowerCase().slice(0, 60))) };
  }

  // ---------------------------------------------------------------- Degree Works

  /** The full audit page as text (requirements, completed and missing courses, credits, GPA). */
  async audit(userId: string, ctx: StepContext): Promise<{ title: string; text: string }> {
    const url = (await this.urls(userId)).degreeworks;
    if (!url) throw new SchoolError('not_configured', "Degree Works is not set up for this student's school (ask the admin to add its URL).");
    await this.open(userId, 'degreeworks', url, ctx);
    await this.run(userId, 'wait', { profile: 'school-degreeworks', ms: 4000 }, ctx.signal);
    // Collapsed requirement blocks hide their courses.
    await this.run(userId, 'tap', { profile: 'school-degreeworks', selector: 'button:has-text("Expand all"), button[aria-label*="Expand all" i]' }, ctx.signal).catch(() => undefined);
    await this.run(userId, 'wait', { profile: 'school-degreeworks', ms: 1500 }, ctx.signal);
    return (await this.run<{ result: { title: string; text: string } }>(userId, 'eval', { profile: 'school-degreeworks', script: PAGE_TEXT }, ctx.signal)).result;
  }
}
