# Tools

A tool is a function the model can call. You define your own with `defineTool` and pass them to `createEngine({ tools })`. The engine adds its built-in tools unless you disable them.

```ts
import { defineTool } from 'pixlai-engine';

const sendEmail = defineTool<{ to: string; body: string }>({
  name: 'email_send',
  description: 'Send an email on behalf of the user',
  parameters: {
    type: 'object',
    properties: { to: { type: 'string' }, body: { type: 'string' } },
    required: ['to', 'body'],
  },
  sideEffect: 'external',
  describe: (args) => ({ summary: `Send an email to ${args.to}`, details: { to: args.to, body: args.body.slice(0, 200) } }),
  async run(args, ctx) {
    await mailer.send(args.to, args.body);
    return { sent: true };
  },
});
```

`defineTool<Args>` only types `args` inside `run` and `describe`. The engine does not check the model's arguments against `parameters`, so validate and coerce inside `run`.

## The `Tool` fields

| Field | Type | Meaning |
|---|---|---|
| `name` | `string` | 1 to 64 characters: letters, digits, `_` and `-`. Must be unique, including against built-ins. Registration throws otherwise. |
| `description` | `string` | Shown to the model. Say when to use the tool and what it returns. |
| `parameters` | `JsonSchema` | JSON Schema of the arguments (`type: 'object'` with `properties` and `required`) |
| `sideEffect` | `'none' \| 'external'` | `external` means the action leaves the user's own workspace and cannot be undone (sending, submitting, deleting remote data). Each call waits for the user's approval. `none` runs freely. |
| `untrusted` | `boolean` (optional) | The result comes from a third party. It is wrapped in `<untrusted_content>` and the model is told to treat it as data. |
| `parallelSafe` | `boolean` (optional) | Read-only and independent of other calls: may run at the same time as neighbouring safe calls |
| `mainAgentOnly` | `boolean` (optional) | Never offered to subagents |
| `gate` | `(args, ctx) => Promise<'run' | 'approve' | { refuse: string }>` (optional) | Per-call decision before running: `approve` waits for the user like an external tool, `refuse` fails with the message. `ctx` has `user`, `runKind`, `host`, `browser`, `browserPolicy`. The browser pack uses it ([Code, web and browser](code-web-browser.md)). |
| `timeoutMs` | `number` (optional) | Overrides `limits.toolTimeoutMs` for this tool, for work that legitimately takes minutes (downloads, indexing) |
| `describe` | `(args) => { summary: string; details?: Record<string, string> }` (optional) | For approvals: one line saying what will happen, plus fields worth showing. Without it the summary is the tool name. |
| `view` | `(args) => Record<string, unknown>` (optional) | The arguments as tool cards show them (events, saved answers). Default: all of them, with texts over 2,000 characters clipped. Leave out what is shown another way or too big to send around. |
| `run` | `(args, ctx) => Promise<unknown>` | Does the work and returns any JSON-serializable value |

Naming: group tools with a prefix (`email_send`, `email_list`) so related tools sort together and do not clash. Built-in names are listed [below](#built-in-tools).

Return values: a string is sent as is, anything else with `JSON.stringify(value, null, 1)`. Results longer than 20,000 characters are cut with a `[truncated: N more characters]` note, so return summaries or let the model page through large data with arguments.

## ToolContext

`run(args, ctx)` receives:

| Field | Meaning |
|---|---|
| `user` | The `UserProfile` the agent works for |
| `runId` | Id of the run |
| `callId` | Id of this tool call |
| `signal` | Aborts when the run is cancelled or the tool times out. Pass it to `fetch`, database calls and child processes. |
| `depth` | 0 for the main agent, 1 or more inside subagents |
| `runKind` | `'chat'`, `'scheduled'` or `'subagent'` |
| `limits` | The effective `Limits` |
| `emit(event)` | Sends an `EngineEvent` to the sink (for example a `notice`). Fire and forget. |
| `memory`, `skills`, `schedules` | The stores, for tools that need them |
| `sandbox?`, `search?`, `fetcher?`, `browser?`, `browserPolicy?` | The code, web and browser ports (see [Code, web and browser](code-web-browser.md)) |
| `workspace?`, `extractor?`, `embeddings?`, `sharedRags?` | The optional ports given to `createEngine` (see [Workspace, files and RAG](workspace-and-rag.md)) |
| `complete(system, prompt)` | One extra model call with the run's model and no tools; returns the text. For tools that summarize or answer from data (`rag_ask` uses it). Counts toward the run's cancellation. |
| `clock`, `logger` | The injected clock and logger |
| `host` | Whatever you passed in `engine.forUser(user, { host })`: your own services (database client, API client, config) so tools do not need globals |
| `askUser?` | `(question) => void`. Ends the run after the current batch with the question as the answer. Only set for the main agent. |
| `spawnSubagent?` | `(goal, index) => Promise<{ status, summary }>`. Only set while `depth < limits.maxSubagentDepth`. |
| `startBackground?` | `(tasks) => Promise<void>`. The host's `startBackground` run option, main agent only. See [background delegation](concepts.md#background-delegation). |

Passing host services:

```ts
const agent = engine.forUser(user, { host: { github: new GitHubClient(user.token) } });

const listRepos = defineTool({
  name: 'github_repos',
  description: 'List the user repositories',
  parameters: { type: 'object', properties: {} },
  sideEffect: 'none',
  parallelSafe: true,
  async run(_args, ctx) {
    const github = ctx.host.github as GitHubClient;   // you cast it; host is Record<string, unknown>
    return await github.listRepos({ signal: ctx.signal });
  },
});
```

## Errors and timeouts

- If `run` throws (or rejects), the model receives `{"error": "<message>"}` as the tool result (message cut to 600 characters) and the call is marked `error`. The run continues, so the model can fix its arguments or try something else. Throw with a message the model can act on.
- Unknown tool names also return an error that lists the available tools.
- Each call gets `limits.toolTimeoutMs` (default 60 seconds), counted from when `run` starts (not including the approval wait). On timeout the model receives `{"error":"Timed out after 60s"}` and `ctx.signal` aborts. Honour `ctx.signal`, or the work keeps running unseen in the background. A tool that legitimately takes minutes (downloads, indexing) sets its own `timeoutMs`.
- If the run is cancelled, the call ends with `{"error":"Skipped: the run was cancelled"}`.
- Do not put secrets in error messages: the model and the sink both see them.

## Batching and parallelism

The model may request several tools in one turn. The engine plans them in order:

- Consecutive `parallelSafe` calls form a batch that runs at the same time, up to 8 per batch.
- Any other call runs alone, and later calls wait for it.
- Tool results are added to the conversation in the order the model requested them, regardless of which finished first.

Mark a tool `parallelSafe` only if it is read-only and does not depend on the output of another call in the same turn. External tools should not be parallel safe: approvals are asked one at a time.

## Approvals from a tool's point of view

For a `sideEffect: 'external'` tool, `run` is called only after the user approves. Your code never sees the approval step and does not need to wait. If the user rejects it or the approval expires, `run` is not called and the model is told not to retry unless the user asks.

Write a good `describe`: it is what the user reads when deciding. Put the facts that matter in `details` (recipient, amount, target) as short strings. `describe` runs before the approval is created, so it must be cheap and must not have side effects. Keep `run` safe to call once: approving does not retry on failure.

## Untrusted results

Set `untrusted: true` on any tool that returns content written by someone other than the user or your own system: web pages, emails, tickets, documents from shared drives. The wrapper and the system-prompt rule help the model resist prompt injection. They do not replace limits on what the agent is allowed to do: keep dangerous actions behind `sideEffect: 'external'`.

## Built-in tools

Added by `createEngine` unless disabled. "Main agent only" tools are not offered to subagents.

| Tool | Purpose | Side effect | Main agent only | Parallel safe |
|---|---|---|---|---|
| `time_now` | Current date and time in the user's timezone or a given IANA timezone | none | no | yes |
| `memory_update` | Edit SOUL.md, USER.md or MEMORY.md with a batch of add / patch / remove / replace, within the size limit | none | yes | no |
| `skills_load` | Load the full instructions of a skill | none | no | yes |
| `skills_note` | Record a short lesson (max 300 characters) on a skill | none | yes | no |
| `plan_update` | Show a checklist of 1 to 20 steps to the user, with an optional short `title` for the plan (`plan` event); send the full list each time, marking the current step `in_progress` | none | no | no |
| `ask_user` | Ask the user 1 to 4 questions with 2 to 4 options each (`multi_select` optional; the user can always write their own answer), or one free-text `question`, and end the run (`awaitingUser`, `questions`). Fails in scheduled runs. | none | yes | no |
| `show_html` | Show a self-contained interactive HTML page in the conversation (`RunResult.displays`, max 3 per run, 200 KB each). Only with `EngineOptions.displays: ['html']`. | your renderer | yes | no |
| `notify` | Send a short notification (`notify` event, max 60 characters title and 200 body, optional http(s) link) | none | yes | no |
| `calc` | Exact arithmetic: `+ - * / % ^`, parentheses, `pi`, `e`, and functions such as `sqrt`, `round`, `min`, `max`, `sum`, `avg`, `log`, `ln`, `pow`, `sin`. No `eval`. | none | no | yes |
| `cron_create` | Create a schedule (cron expression, interval, or one-off date) | none | yes | no |
| `cron_list` | List the user's schedules | none | yes | yes |
| `cron_update` | Change, pause or resume a schedule | none | yes | no |
| `cron_delete` | Delete a schedule | none | yes | no |
| `agent_delegate` | Run up to `maxParallelSubagents` helper agents in parallel and collect their reports, or start them in the background (`background: true`) when the host supports it | none | no | no |

Notes:

- `cron_*` tools only work in `chat` runs and are removed from `scheduled` runs.
- `agent_delegate` is removed when `maxSubagentDepth` is 0.
- A subagent gets every tool that has `sideEffect: 'none'` and is not main-agent-only: the built-ins `time_now`, `skills_load`, `plan_update`, `calc` and `agent_delegate` (while depth allows), plus your own tools that qualify.

The tool arrays are exported (`BUILTIN_TOOLS`, `CORE_TOOLS`, `CRON_TOOLS`), as is the `evaluate` function behind `calc`.

### Disabling built-ins

```ts
const engine = createEngine({
  stores,
  basePrompt,
  disableBuiltins: ['notify', 'cron_create', 'cron_list', 'cron_update', 'cron_delete'],
});
```

`disableBuiltins` takes tool names. Disabling a tool does not rewrite the system prompt: if you disable `skills_load` but your `SkillStore` still lists skills, the prompt still tells the model to load them. Use an empty skill store in that case.

### Filtering tools per run

`toolFilter` narrows the tools for one run. It is applied after the run-kind rules, and subagents inherit the narrowed set.

```ts
await agent.run({
  runId,
  model,
  history,
  sink,
  toolFilter: (tool) => !disabledByUser.has(tool.name) && tool.sideEffect === 'none',
});
```

`agent.tools()` returns the tools a normal chat run would offer, which is useful for building a settings screen.

## Tool packs and roadmap

Packs turn on when the host provides their port (a `workspace` enables files, `embeddings` with it enables rag, and so on). Rows marked **Planned** are the roadmap: names and behaviour may change, and packs that need infrastructure will ask the host for it through a port instead of assuming a vendor.

| Pack | Planned tools | Port the host provides | Status |
|---|---|---|---|
| core | `plan_update`, `ask_user`, `notify`, `time_now`, `calc` | Notifications (optional) | Available now (see above) |
| memory | SOUL.md, USER.md and MEMORY.md with `memory_update` (Hermes style) | `MemoryStore` | Done |
| skills v2 | `skills_list`, `skills_load`, `skills_read_file`, `skills_note`, `skills_create`, `skills_patch` (the agent writes and improves skills) | `SkillStore` | Planned |
| web | `web_search`, `web_fetch` (HTML to clean text), `web_download` | `SearchPort`, `FetchPort` | Available ([docs](code-web-browser.md)); `web_extract` planned |
| files | `files_list/read/write/mkdir/move/delete/search/usage` in the user's workspace | `WorkspacePort` | Available ([docs](workspace-and-rag.md)); `files_patch` planned |
| rag | `rag_list/create/add/search/ask/delete`, plus read-only shared RAGs | `EmbeddingPort`, `TextExtractor`, `SharedRagSource` | Available ([docs](workspace-and-rag.md)) |
| documents | Read PDF, DOCX, PPTX into text (through `TextExtractor`); XLSX and CSV as tables; generate documents | `TextExtractor`, `WorkspacePort` | Reading available through the host's extractor; tables and generation planned |
| code | `code_run` (Python, Node, shell in a sandbox, with timeout and bounded output) | `SandboxPort` | Available ([docs](code-web-browser.md)) |
| browser | `browser_open/snapshot/click/type/press/scroll/back/screenshot/close`, cookie profiles, approval policy | `BrowserPort`, `BrowserPolicy` | Available ([docs](code-web-browser.md)) |
| data | Queries over CSV and JSON (filter, group, chart to image) | `SandboxPort` | Planned |
| http | `http_request` to APIs the host allows (allowlist) | Host config | Planned |
| mcp client | Connect external MCP servers and expose their tools | `McpPort` | Planned |
| agents | `agent_delegate` with `output_schema`, steering of subagents | `RunStore` | Planned (delegation, background delegation and stopping through the host exist) |
| cron | `cron_*` plus a "monitor" mode (runs only when something changed) and context from the previous run | `ScheduleStore` | Planned (basic `cron_*` exists) |

Other planned work that touches tools: hooks (`beforeModelCall`, `beforeToolCall`, `afterToolCall`, `onRunEnd`), a skills loader from disk, telemetry through events, and an evals runner.
