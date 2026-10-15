import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  htmlToText,
  SearchChain,
  InMemoryWorkspace,
  type BrowserAction,
  type BrowserPage,
  type BrowserPolicy,
  type BrowserPort,
  type ExecRequest,
  type FetchPort,
  type SandboxPort,
  type SearchPort,
} from '../src/index.js';
import { model, ScriptedProvider, setup, text, toolCall } from './helpers.js';

const user = (content: string) => ({ role: 'user' as const, content });
const lastTool = (p: ScriptedProvider, n = 1) => p.requests[n]!.messages.at(-1)!.content;
const tick = () => new Promise((r) => setTimeout(r, 20));

// ------------------------------------------------------------------ code

class FakeSandbox implements SandboxPort {
  requests: ExecRequest[] = [];
  async describe() {
    return 'Python 3.12 with pandas and matplotlib. No network.';
  }
  async exec(_userId: string, request: ExecRequest) {
    this.requests.push(request);
    if (request.code.includes('sleep')) return { exitCode: null, stdout: '', stderr: '', timedOut: true, durationMs: request.timeoutMs };
    return { exitCode: 0, stdout: 'x'.repeat(20_000) + 'THE END', stderr: '', timedOut: false, durationMs: 1234, files: [{ path: 'chart.png', size: 20480 }] };
  }
}

test('code_run runs in the sandbox, keeps the end of long output and lists new files', async () => {
  const sandbox = new FakeSandbox();
  const { agent, sink } = setup({ sandbox });
  const p = new ScriptedProvider([
    () => [...toolCall('code_run', { language: 'python', code: 'print(1)', cwd: 'Fall 2026', timeout_s: 9999 }, 'a'), ...toolCall('code_run', { language: 'python', code: 'sleep(500)' }, 'b')],
    () => text('ok'),
  ]);
  await agent.run({ runId: 'r1', model: model(p), history: [user('graph it')], sink });
  assert.match(p.requests[0]!.messages[0]!.content, /## Code sandbox\nPython 3\.12 with pandas/);
  assert.deepEqual(sandbox.requests[0], { language: 'python', code: 'print(1)', cwd: 'Fall 2026', timeoutMs: 300_000 });
  const results = p.requests[1]!.messages.filter((m) => m.role === 'tool').map((m) => m.content);
  assert.match(results[0]!, /characters cut/);
  assert.match(results[0]!, /THE END/);
  assert.match(results[0]!, /"path": "chart\.png"/);
  assert.match(results[1]!, /"timed_out": "stopped after 60s"/);
});

test('code_run refuses paths outside the workspace and unknown languages', async () => {
  const { agent, sink } = setup({ sandbox: new FakeSandbox() });
  const p = new ScriptedProvider([
    () => [...toolCall('code_run', { language: 'python', code: 'x', cwd: '../other' }, 'a'), ...toolCall('code_run', { language: 'ruby', code: 'x' }, 'b')],
    () => text('ok'),
  ]);
  await agent.run({ runId: 'r1', model: model(p), history: [user('x')], sink });
  const results = p.requests[1]!.messages.filter((m) => m.role === 'tool').map((m) => m.content);
  assert.match(results[0]!, /Invalid path|\.\./);
  assert.match(results[1]!, /language must be one of/);
});

test('code_run defaults to Python when the language is left out', async () => {
  const sandbox = new FakeSandbox();
  const { agent, sink } = setup({ sandbox });
  const p = new ScriptedProvider([() => toolCall('code_run', { code: 'print(1)' }, 'a'), () => text('ok')]);
  await agent.run({ runId: 'r1', model: model(p), history: [user('x')], sink });
  assert.equal(sandbox.requests[0]!.language, 'python');
});

// ------------------------------------------------------------------ web

test('htmlToText keeps the content and drops the chrome', () => {
  const html = `<html><head><title>Accrual &amp; cash</title><style>p{}</style></head><body>
    <nav><a href="/">Home</a></nav>
    <main><h1>Accrual basis</h1><p>Revenue is recorded when <b>earned</b>, not when cash arrives.</p>
      <ul><li>Matching principle</li><li>See <a href="/ch5.html">chapter 5</a></li></ul>
      <div class="hidden-xs">Visible on desktop</div><div hidden>secret</div><span aria-hidden="true">icon</span>
      <table><tr><td>Debit</td><td>Credit</td></tr></table>${'<p>More text about the accrual basis.</p>'.repeat(20)}</main>
    <script>alert('x')</script><footer>© 2026</footer></body></html>`;
  const { title, text: out } = htmlToText(html, 'https://acct.example.edu/notes/intro.html');
  assert.equal(title, 'Accrual & cash');
  assert.match(out, /^# Accrual basis/);
  assert.match(out, /Revenue is recorded when earned, not when cash arrives\./);
  assert.match(out, /- See \[chapter 5\]\(https:\/\/acct\.example\.edu\/ch5\.html\)/);
  assert.match(out, /Visible on desktop/);
  assert.match(out, /Debit \| Credit/);
  for (const gone of ['Home', 'alert', '©', 'secret', 'icon', 'p{}']) assert.ok(!out.includes(gone), gone);
});

class FakeSearch implements SearchPort {
  queries: string[] = [];
  async search(query: string, options: { limit: number }) {
    this.queries.push(query);
    return Array.from({ length: 20 }, (_, i) => ({ title: `Result ${i + 1}`, url: `https://site${i}.example/`, snippet: `About ${query}` })).slice(0, options.limit);
  }
}

class FakeFetch implements FetchPort {
  async fetch(url: string) {
    if (url.endsWith('.pdf')) return { url, status: 200, contentType: 'application/pdf', body: Buffer.from('%PDF\nPage one text\fPage two text') };
    if (url.includes('missing')) return { url, status: 404, contentType: 'text/html', body: Buffer.from('nope') };
    const body = `<html><head><title>Long</title></head><body><p>${'word '.repeat(5000)}</p><p>LAST</p></body></html>`;
    return { url: url.replace('http:', 'https:'), status: 200, contentType: 'text/html; charset=utf-8', body: Buffer.from(body) };
  }
}

const pdfExtractor = {
  async extract(data: Buffer, filename: string) {
    return filename.endsWith('.pdf') ? { pages: data.toString('utf8').replace(/^%PDF\n/, '').split('\f') } : null;
  },
};

test('web_search, web_fetch in parts and documents, web_download into the workspace', async () => {
  const workspace = new InMemoryWorkspace();
  const search = new FakeSearch();
  const { agent, sink } = setup({ search, fetcher: new FakeFetch(), workspace, extractor: pdfExtractor });
  const p = new ScriptedProvider([
    () => [
      ...toolCall('web_search', { query: 'accrual vs cash basis', limit: 50 }, 'a'),
      ...toolCall('web_fetch', { url: 'http://long.example/page' }, 'b'),
      ...toolCall('web_fetch', { url: 'https://long.example/page', offset: 15000 }, 'c'),
      ...toolCall('web_fetch', { url: 'https://docs.example/syllabus.pdf', page: 2 }, 'd'),
      ...toolCall('web_fetch', { url: 'https://x.example/missing' }, 'e'),
      ...toolCall('web_fetch', { url: 'file:///etc/passwd' }, 'f'),
    ],
    () => toolCall('web_download', { url: 'https://docs.example/syllabus.pdf' }, 'g'),
    () => text('ok'),
  ]);
  await agent.run({ runId: 'r1', model: model(p), history: [user('research')], sink });
  const r = p.requests[1]!.messages.filter((m) => m.role === 'tool').map((m) => m.content);
  assert.match(r[0]!, /^<untrusted_content source="web_search">/);
  assert.equal((r[0]!.match(/"url":/g) ?? []).length, 10, 'limit capped at 10');
  assert.match(r[1]!, /"title": "Long"[\s\S]*"next_offset": 15000/);
  assert.match(r[2]!, /LAST/);
  assert.ok(!/next_offset/.test(r[2]!));
  assert.match(r[3]!, /"pages": 2[\s\S]*Page two text/);
  assert.match(r[4]!, /"status": 404/);
  assert.match(r[5]!, /Only http and https/);
  assert.match(lastTool(p, 2), /"saved": "TEMP\/web\/syllabus\.pdf"/);
  assert.equal((await workspace.read('u1', 'TEMP/web/syllabus.pdf')).toString('utf8').slice(0, 4), '%PDF');
});

test('web tools only appear with their ports', () => {
  const none = setup().agent.tools().map((t) => t.name);
  assert.ok(!none.some((n) => n.startsWith('web_search') || n.startsWith('web_fetch') || n.startsWith('browser_') || n === 'code_run'));
  const fetchOnly = setup({ fetcher: new FakeFetch() }).agent.tools().map((t) => t.name);
  assert.ok(fetchOnly.includes('web_fetch') && !fetchOnly.includes('web_download') && !fetchOnly.includes('web_search'));
});

// ------------------------------------------------------------------ browser

class FakeBrowser implements BrowserPort {
  pages = new Map<string, string>();
  actions: BrowserAction[] = [];
  page(url: string): BrowserPage {
    return { url, title: 'Page', snapshot: `heading "Hello"\nbutton "Submit" [@e1]\ntextbox "Search" [@e2]` };
  }
  async open(_u: string, profile: string, url: string) {
    this.pages.set(profile, url);
    return this.page(url);
  }
  async snapshot(_u: string, profile: string) {
    return this.page(this.pages.get(profile)!);
  }
  async act(_u: string, profile: string, action: BrowserAction) {
    this.actions.push(action);
    return this.page(this.pages.get(profile)!);
  }
  async screenshot() {
    return { path: 'TEMP/screenshots/page.png' };
  }
  async currentUrl(_u: string, profile: string) {
    return this.pages.get(profile) ?? null;
  }
  async close(_u: string, profile: string) {
    this.pages.delete(profile);
  }
}

/** Like EagleDocs: Canvas is read-only, a trusted site runs freely, the rest asks. */
const policy: BrowserPolicy = async (_userId, url) => {
  const host = new URL(url).hostname;
  if (host === 'canvas.uni.edu') return { block: 'Canvas is read-only in this app' };
  if (host === 'trusted.example') return 'allow';
  return 'approve';
};

test('browser: reading is free, actions follow the policy (allow, approve, block)', async () => {
  const browser = new FakeBrowser();
  const { agent, stores, sink } = setup({ browser, browserPolicy: policy });
  const p = new ScriptedProvider([
    () => toolCall('browser_click', { ref: '@e1' }, 'a'),
    () => toolCall('browser_open', { url: 'https://trusted.example/form' }, 'b'),
    () => toolCall('browser_type', { ref: '@e2', text: 'FIFO', submit: true }, 'c'),
    () => toolCall('browser_open', { url: 'https://canvas.uni.edu/courses/1/quizzes/9', profile: 'school' }, 'd'),
    () => toolCall('browser_click', { ref: '@e1', profile: 'school' }, 'e'),
    () => toolCall('browser_open', { url: 'https://shop.example/' }, 'f'),
    () => toolCall('browser_click', { ref: '@e1' }, 'g'),
    () => text('done'),
  ]);
  const run = agent.run({ runId: 'r1', model: model(p), history: [user('do it')], sink });
  while (stores.runs.created.length === 0) await tick();
  assert.equal(stores.runs.created[0]!.summary, 'Click @e1 in the browser');
  stores.runs.decide(stores.runs.created[0]!.id, 'approved');
  await run;

  assert.match(lastTool(p, 1), /No page is open/);
  assert.match(lastTool(p, 2), /^<untrusted_content source="browser_open">[\s\S]*\[@e1\]/);
  assert.match(lastTool(p, 4), /trusted\.example|canvas/);
  assert.match(lastTool(p, 5), /Canvas is read-only in this app/);
  assert.equal(stores.runs.created.length, 1, 'only the unknown site asked');
  // Typed on the trusted site without asking, never clicked on Canvas, clicked on the shop after approval.
  assert.deepEqual(browser.actions, [
    { kind: 'type', ref: '@e2', text: 'FIFO', submit: true },
    { kind: 'click', ref: '@e1' },
  ]);
});

test('browser: scheduled runs may only do what the policy allows outright; browser tools stay out of subagents', async () => {
  const browser = new FakeBrowser();
  await browser.open('u1', 'default', 'https://shop.example/');
  const { agent, stores, sink } = setup({ browser, browserPolicy: policy });
  const p = new ScriptedProvider([() => toolCall('browser_click', { ref: '@e1' }, 'a'), () => text('ok')]);
  await agent.run({ runId: 'r1', model: model(p), history: [user('x')], sink, kind: 'scheduled' });
  assert.match(lastTool(p), /needs the user here/);
  assert.equal(stores.runs.created.length, 0);
  assert.equal(browser.actions.length, 0);

  const names = agent.tools().map((t) => t.name);
  assert.ok(names.includes('browser_open'));
  const subagentTools = agent.tools().filter((t) => t.sideEffect === 'none' && !t.mainAgentOnly).map((t) => t.name);
  assert.ok(!subagentTools.some((n) => n.startsWith('browser_')));
});

test('browser: without a policy every action asks', async () => {
  const browser = new FakeBrowser();
  await browser.open('u1', 'default', 'https://trusted.example/');
  const { agent, stores, sink } = setup({ browser });
  const p = new ScriptedProvider([() => toolCall('browser_press', { key: 'Enter' }, 'a'), () => text('ok')]);
  const run = agent.run({ runId: 'r1', model: model(p), history: [user('x')], sink });
  while (stores.runs.created.length === 0) await tick();
  stores.runs.decide(stores.runs.created[0]!.id, 'rejected');
  await run;
  assert.match(lastTool(p), /rejected it/);
  assert.equal(browser.actions.length, 0);
});

// ------------------------------------------------------------------ search chain and reading pages in the browser

test('SearchChain: next provider on failure or no results, skips a failed one for a while, throws only when all fail', async () => {
  let now = 0;
  const calls: string[] = [];
  const hit = (name: string) => [{ title: name, url: `https://${name}.example/`, snippet: '' }];
  let blocked = true;
  let paidOn = false;
  const chain = new SearchChain(
    [
      { name: 'free', search: async () => (calls.push('free'), blocked ? Promise.reject(new Error('anti-bot page')) : hit('free')) },
      { name: 'empty', search: async () => (calls.push('empty'), []) },
      { name: 'paid', enabled: () => paidOn, search: async () => (calls.push('paid'), hit('paid')) },
      { name: 'browser', search: async () => (calls.push('browser'), hit('browser')) },
    ],
    { cooldownMs: 60_000, now: () => now },
  );
  const opts = { limit: 5, signal: new AbortController().signal };
  assert.equal((await chain.search('q', opts))[0]!.title, 'browser', 'a paid provider without a key is skipped');
  assert.deepEqual(calls, ['free', 'empty', 'browser']);
  paidOn = true;
  calls.length = 0;
  assert.equal((await chain.search('q', opts))[0]!.title, 'paid');
  assert.deepEqual(calls, ['empty', 'paid'], 'the provider that failed is not tried first while it cools down');
  now = 61_000;
  blocked = false;
  calls.length = 0;
  assert.equal((await chain.search('q', opts))[0]!.title, 'free', 'after the cooldown it is first again');
  const dead = new SearchChain([{ name: 'a', search: async () => Promise.reject(new Error('down')) }]);
  await assert.rejects(dead.search('q', opts), /not available right now \(a: down\)/);
  const nothing = new SearchChain([{ name: 'a', search: async () => [] }]);
  assert.deepEqual(await nothing.search('q', opts), [], 'an answer with no results is an answer');
});

test('web_fetch reads pages drawn by JavaScript and pages behind a bot check in the browser', async () => {
  class AppFetch implements FetchPort {
    async fetch(url: string) {
      if (url.includes('blocked')) return { url, status: 403, contentType: 'text/html', body: Buffer.from('Just a moment...') };
      if (url.includes('gone')) return { url, status: 404, contentType: 'text/html', body: Buffer.from('nope') };
      return { url, status: 200, contentType: 'text/html', body: Buffer.from('<html><body><div id="root"></div><script src="/app.js"></script></body></html>') };
    }
  }
  const browser = new FakeBrowser();
  browser.page = (url: string) => ({ url, title: 'Rendered', snapshot: `heading "Course schedule"\n${'Week 1 Intro to accounting. '.repeat(30)}` });
  const { agent, sink } = setup({ fetcher: new AppFetch(), browser });
  const p = new ScriptedProvider([
    () => [
      ...toolCall('web_fetch', { url: 'https://spa.example/schedule' }, 'a'),
      ...toolCall('web_fetch', { url: 'https://blocked.example/' }, 'b'),
      ...toolCall('web_fetch', { url: 'https://gone.example/' }, 'c'),
    ],
    () => text('ok'),
  ]);
  await agent.run({ runId: 'r1', model: model(p), history: [user('read it')], sink });
  const r = p.requests[1]!.messages.filter((m) => m.role === 'tool').map((m) => m.content);
  assert.match(r[0]!, /"read_with": "browser"[\s\S]*Course schedule/);
  assert.match(r[1]!, /"read_with": "browser"/);
  assert.match(r[2]!, /"status": 404/, 'a page that does not exist is not opened in the browser');
  assert.equal(browser.pages.size, 0, 'the reader profile is closed afterwards');
  const plain = setup({ fetcher: new AppFetch() });
  const q = new ScriptedProvider([() => toolCall('web_fetch', { url: 'https://blocked.example/' }), () => text('ok')]);
  await plain.agent.run({ runId: 'r2', model: model(q), history: [user('read it')], sink: plain.sink });
  assert.match(q.requests[1]!.messages.at(-1)!.content, /"status": 403/, 'without a browser the block is reported');
});
