import type { BrowserAction, BrowserPage, BrowserPort } from '../ports.js';
import { defineTool, type GateContext, type Tool, type ToolContext } from '../tools/tool.js';

/** Snapshot characters sent to the model per page view. */
const SNAPSHOT_CHARS = 12_000;
const PROFILE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const BROWSER_TIMEOUT_MS = 90_000;

function browserOf(ctx: Pick<ToolContext, 'browser'>): BrowserPort {
  if (!ctx.browser) throw new Error('The browser is not available here');
  return ctx.browser;
}

function profileOf(raw: unknown): string {
  const profile = String(raw ?? 'default').trim().toLowerCase() || 'default';
  if (!PROFILE.test(profile)) throw new Error('profile: lowercase letters, digits, - and _ (e.g. "default", "outlook")');
  return profile;
}

function view(page: BrowserPage) {
  const clipped = page.snapshot.length > SNAPSHOT_CHARS;
  return {
    url: page.url,
    title: page.title,
    snapshot: clipped ? `${page.snapshot.slice(0, SNAPSHOT_CHARS)}\n[... page continues: scroll down and snapshot again ...]` : page.snapshot,
  };
}

/**
 * Acting on a page (click, type, keys) is checked against the host's policy
 * for the page it would happen on. Without a policy every action needs the
 * user's approval: a click can submit, buy or delete.
 */
function actionGate(kind: BrowserAction['kind']) {
  return async (args: { profile?: string }, ctx: GateContext): Promise<'run' | 'approve' | { refuse: string }> => {
    const url = await browserOf(ctx).currentUrl(ctx.user.id, profileOf(args.profile));
    if (!url) return { refuse: 'No page is open in this profile: use browser_open first' };
    if (ctx.runKind !== 'chat') {
      // Nobody is there to approve in scheduled runs and subagents: only what the policy allows outright.
      const decision = ctx.browserPolicy ? await ctx.browserPolicy(ctx.user.id, url, kind) : 'approve';
      return decision === 'allow' ? 'run' : { refuse: 'Acting on pages needs the user here; tell them what you would do instead' };
    }
    if (!ctx.browserPolicy) return 'approve';
    const decision = await ctx.browserPolicy(ctx.user.id, url, kind);
    if (typeof decision === 'object') return { refuse: decision.block };
    return decision === 'allow' ? 'run' : 'approve';
  };
}

const profileParam = { type: 'string', description: 'Cookie profile: "default", or a name to keep a login apart (e.g. "outlook")' };
const refParam = { type: 'string', description: 'Element ref from the latest snapshot, e.g. "@e12"' };

export const browserOpen = defineTool<{ url: string; profile?: string }>({
  name: 'browser_open',
  summary: 'open a site in a real browser (stays signed in, clicks and types like a person)',
  description:
    "Open a URL in the user's own browser (a real Chromium that keeps cookies, so sites they logged into stay logged in). " +
    'Returns a snapshot of the page: text and interactive elements with refs like [@e12] for browser_click/browser_type. ' +
    'Prefer web_fetch for plain public pages; use the browser for logins, JavaScript apps and multi-step flows.',
  parameters: { type: 'object', properties: { url: { type: 'string' }, profile: profileParam }, required: ['url'] },
  sideEffect: 'none',
  untrusted: true,
  mainAgentOnly: true,
  timeoutMs: BROWSER_TIMEOUT_MS,
  async run(args, ctx) {
    let url: URL;
    try {
      url = new URL(String(args.url ?? '').trim());
    } catch {
      throw new Error('Give a full URL starting with http:// or https://');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only http and https URLs can be opened');
    return view(await browserOf(ctx).open(ctx.user.id, profileOf(args.profile), url.toString(), ctx.signal));
  },
});

export const browserSnapshot = defineTool<{ profile?: string }>({
  name: 'browser_snapshot',
  summary: 'read the open page again',
  description: 'Read the page that is open now again (after it changed, or after scrolling).',
  parameters: { type: 'object', properties: { profile: profileParam } },
  sideEffect: 'none',
  untrusted: true,
  mainAgentOnly: true,
  timeoutMs: BROWSER_TIMEOUT_MS,
  async run(args, ctx) {
    return view(await browserOf(ctx).snapshot(ctx.user.id, profileOf(args.profile), ctx.signal));
  },
});

export const browserClick = defineTool<{ ref: string; profile?: string }>({
  name: 'browser_click',
  summary: 'click something on the open page',
  description: 'Click an element of the open page by its ref. May need the user\'s approval depending on the site.',
  parameters: { type: 'object', properties: { ref: refParam, profile: profileParam }, required: ['ref'] },
  sideEffect: 'none',
  untrusted: true,
  mainAgentOnly: true,
  timeoutMs: BROWSER_TIMEOUT_MS,
  gate: actionGate('click'),
  describe: (a) => ({ summary: `Click ${a.ref} in the browser`, details: { element: String(a.ref) } }),
  async run(args, ctx) {
    return view(await browserOf(ctx).act(ctx.user.id, profileOf(args.profile), { kind: 'click', ref: String(args.ref) }, ctx.signal));
  },
});

export const browserType = defineTool<{ ref: string; text: string; submit?: boolean; profile?: string }>({
  name: 'browser_type',
  summary: 'type into a field on the open page',
  description: 'Type text into a field of the open page (replacing what it had). submit: press Enter after typing.',
  parameters: {
    type: 'object',
    properties: { ref: refParam, text: { type: 'string' }, submit: { type: 'boolean' }, profile: profileParam },
    required: ['ref', 'text'],
  },
  sideEffect: 'none',
  untrusted: true,
  mainAgentOnly: true,
  timeoutMs: BROWSER_TIMEOUT_MS,
  gate: actionGate('type'),
  describe: (a) => ({
    summary: `Type into ${a.ref}${a.submit ? ' and press Enter' : ''}`,
    details: { element: String(a.ref), text: String(a.text).slice(0, 200) },
  }),
  async run(args, ctx) {
    const action: BrowserAction = { kind: 'type', ref: String(args.ref), text: String(args.text ?? ''), submit: Boolean(args.submit) };
    return view(await browserOf(ctx).act(ctx.user.id, profileOf(args.profile), action, ctx.signal));
  },
});

export const browserPress = defineTool<{ key: string; profile?: string }>({
  name: 'browser_press',
  summary: 'press a key on the open page',
  description: 'Press a key on the open page, e.g. "Enter", "Escape", "Tab", "ArrowDown".',
  parameters: { type: 'object', properties: { key: { type: 'string' }, profile: profileParam }, required: ['key'] },
  sideEffect: 'none',
  untrusted: true,
  mainAgentOnly: true,
  timeoutMs: BROWSER_TIMEOUT_MS,
  gate: actionGate('press'),
  describe: (a) => ({ summary: `Press ${a.key} in the browser`, details: { key: String(a.key) } }),
  async run(args, ctx) {
    const key = String(args.key ?? '').trim();
    if (!/^[A-Za-z0-9+]{1,30}$/.test(key)) throw new Error('key: a key name like "Enter" or "Control+A"');
    return view(await browserOf(ctx).act(ctx.user.id, profileOf(args.profile), { kind: 'press', key }, ctx.signal));
  },
});

export const browserScroll = defineTool<{ direction: 'up' | 'down'; profile?: string }>({
  name: 'browser_scroll',
  summary: 'scroll the open page',
  description: 'Scroll the open page one screen up or down and return the new snapshot.',
  parameters: { type: 'object', properties: { direction: { type: 'string', enum: ['up', 'down'] }, profile: profileParam }, required: ['direction'] },
  sideEffect: 'none',
  untrusted: true,
  mainAgentOnly: true,
  timeoutMs: BROWSER_TIMEOUT_MS,
  async run(args, ctx) {
    const direction = args.direction === 'up' ? 'up' : 'down';
    return view(await browserOf(ctx).act(ctx.user.id, profileOf(args.profile), { kind: 'scroll', direction }, ctx.signal));
  },
});

export const browserBack = defineTool<{ profile?: string }>({
  name: 'browser_back',
  summary: 'go back a page',
  description: 'Go back to the previous page.',
  parameters: { type: 'object', properties: { profile: profileParam } },
  sideEffect: 'none',
  untrusted: true,
  mainAgentOnly: true,
  timeoutMs: BROWSER_TIMEOUT_MS,
  async run(args, ctx) {
    return view(await browserOf(ctx).act(ctx.user.id, profileOf(args.profile), { kind: 'back' }, ctx.signal));
  },
});

export const browserScreenshot = defineTool<{ profile?: string }>({
  name: 'browser_screenshot',
  summary: 'save a picture of the open page',
  description: "Save a picture of the open page into the user's files (to show them what you see, or keep evidence).",
  parameters: { type: 'object', properties: { profile: profileParam } },
  sideEffect: 'none',
  mainAgentOnly: true,
  timeoutMs: BROWSER_TIMEOUT_MS,
  async run(args, ctx) {
    return browserOf(ctx).screenshot(ctx.user.id, profileOf(args.profile), ctx.signal);
  },
});

export const browserClose = defineTool<{ profile?: string }>({
  name: 'browser_close',
  summary: 'close the browser when done',
  description: 'Close the browser for this profile when you are done (cookies are kept for next time).',
  parameters: { type: 'object', properties: { profile: profileParam } },
  sideEffect: 'none',
  mainAgentOnly: true,
  async run(args, ctx) {
    await browserOf(ctx).close(ctx.user.id, profileOf(args.profile));
    return { closed: true };
  },
});

export const BROWSER_TOOLS: Tool[] = [
  browserOpen,
  browserSnapshot,
  browserClick,
  browserType,
  browserPress,
  browserScroll,
  browserBack,
  browserScreenshot,
  browserClose,
];
