# Code, web and browser

Three optional packs give the agent hands outside the conversation. Each one
appears only when you pass the port it needs:

| Pack | Option | Tools |
|---|---|---|
| code | `sandbox: SandboxPort` | `code_run` |
| web | `search: SearchPort` | `web_search` |
| | `fetcher: FetchPort` | `web_fetch`, and with a `workspace` also `web_download` |
| browser | `browser: BrowserPort` (+ optional `browserPolicy`) | `browser_open`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_press`, `browser_scroll`, `browser_back`, `browser_screenshot`, `browser_close` |

```ts
const engine = createEngine({
  stores,
  basePrompt,
  workspace,                 // the files code_run and web_download work with
  sandbox: mySandbox,        // runs code where the workspace is the working tree
  search: mySearch,          // SearXNG, Brave, Google CSE...
  fetcher: myFetcher,        // downloads public URLs safely (SSRF rules are yours)
  browser: myBrowser,        // a real Chromium per user (Playwright...)
  browserPolicy: myPolicy,   // which clicks run, ask or are blocked
});
```

## SandboxPort and `code_run`

```ts
interface SandboxPort {
  describe(userId: string): Promise<string>;
  exec(userId: string, request: ExecRequest, signal: AbortSignal): Promise<ExecResult>;
}
interface ExecRequest { language: 'python' | 'node' | 'shell'; code: string; cwd: string; timeoutMs: number }
interface ExecResult { exitCode: number | null; stdout: string; stderr: string; timedOut: boolean; durationMs: number; files?: { path: string; size: number }[] }
```

- The working directory is the user's workspace: `cwd` is relative to it (already checked for `..`). The same files the
  files pack and `WorkspacePort` see, so the agent can download a CSV with `web_download`, analyze it with `code_run`
  and the user downloads the chart from their files.
- `describe` goes into the system prompt under `## Code sandbox` whenever `code_run` is offered. It must be cheap (answer
  from config, do not start a container): say what is installed and what is not allowed, e.g. "Python 3.12 with pandas,
  matplotlib, openpyxl; no network".
- Isolation, CPU/memory limits and the network policy are entirely the host's job. Return `exitCode: null` when the
  process was killed and `timedOut: true` when your timeout fired.
- `code_run` accepts a timeout of 1 to 300 seconds (default 60), keeps the head and the tail of long output (8,000
  characters per stream; tracebacks are at the end) and lists up to 50 `files` the run created or changed.
- It is not main-agent-only: subagents can run code in parallel. Calls are stateless; tell the model (the description
  does) to keep intermediate results in files.

## SearchPort, FetchPort and the web pack

```ts
interface SearchPort {
  search(query: string, options: { limit: number; language?: string; signal: AbortSignal }): Promise<SearchHit[]>;
}
interface FetchPort {
  fetch(url: string, options: { maxBytes: number; signal: AbortSignal }): Promise<FetchedPage>;
}
interface FetchedPage { url: string; status: number; contentType: string; body: Buffer }
```

- `web_search`: up to 10 results with title, URL and snippet. Results are untrusted content.
- `web_fetch`: reads a URL as text. HTML goes through `htmlToText` (exported): it keeps headings, paragraphs, lists,
  table rows and links as Markdown, drops scripts, styles, navigation, footers, forms and elements with `hidden` or
  `aria-hidden="true"`, and prefers the page's `<main>`/`<article>`. Documents (PDF, DOCX...) go through your
  `TextExtractor`, with a `page` argument. Long content comes in parts of 15,000 characters with `next_offset`. Up to
  10 MB. Results are untrusted content.
- `web_download`: saves the file into the workspace (default `TEMP/web/`), up to 100 MB, for `files_read`, `rag_add` or
  `code_run`.
- **Your `FetchPort` is the security boundary.** Refuse private and loopback addresses (also after DNS resolution and
  on every redirect), cap the size, and set a timeout. The tools only accept `http:` and `https:` URLs.

## BrowserPort, the browser pack and its policy

```ts
interface BrowserPort {
  open(userId, profile, url, signal): Promise<BrowserPage>;
  snapshot(userId, profile, signal): Promise<BrowserPage>;
  act(userId, profile, action: BrowserAction, signal): Promise<BrowserPage>;
  screenshot(userId, profile, signal): Promise<{ path: string }>;
  currentUrl(userId, profile): Promise<string | null>;
  close(userId, profile): Promise<void>;
}
type BrowserAction =
  | { kind: 'click'; ref: string }
  | { kind: 'type'; ref: string; text: string; submit: boolean }
  | { kind: 'press'; key: string }
  | { kind: 'scroll'; direction: 'up' | 'down' }
  | { kind: 'back' };
interface BrowserPage { url: string; title: string; snapshot: string }
```

- **Profiles** are cookie jars: `"default"`, or a name per site (`"outlook"`) so one login does not leak into another.
  Keep them between runs: that is what lets a user log in once.
- **Snapshots** are text for the model: an outline of the page (an accessibility tree works well) where every element
  the agent can use carries a ref like `[@e12]`. The tools send up to 12,000 characters and tell the model to scroll
  for more. Snapshots are untrusted content.
- `browser_screenshot` saves a PNG into the workspace and returns its path; the model gets the path, the user sees the
  picture in their files.

### Who decides what the agent may do

Reading (`open`, `snapshot`, `scroll`, `back`, `screenshot`, `close`) always runs. Acting (`click`, `type`, `press`)
goes through a **gate** (see [Tools](tools.md#the-tool-fields)) that asks your policy about the page it would happen on:

```ts
type BrowserPolicy = (userId: string, url: string, action: 'click' | 'type' | 'press' | ...) =>
  Promise<'allow' | 'approve' | { block: string }>;
```

| Policy answer | Chat run | Scheduled run |
|---|---|---|
| `'allow'` | runs | runs |
| `'approve'` | waits for the user's approval, like an external tool | refused: nobody is there to approve |
| `{ block }` | refused with your message | refused |
| no policy given | every action asks | refused |

EagleDocs, for example, allows actions on domains the user marked as trusted, asks everywhere else, and blocks every
action on the school's Canvas (the app is read-only there; it reads Canvas through its API tools).

All browser tools are main-agent-only: subagents cannot drive the user's logged-in browser.

## Writing a gate for your own tools

The browser pack is built on a generic feature: any tool can have a `gate(args, ctx)` that runs before the call and
returns `'run'`, `'approve'` or `{ refuse: message }`. Use it when the risk of a call depends on its arguments or on
state, for example "transfers under $20 run, larger ones ask". `ctx` has `user`, `runKind`, `host`, `browser` and
`browserPolicy`.
