# PixlAI-Engine

A multi-user agent engine for Node.js: a tool-calling loop with live steering,
approvals for irreversible actions, parallel subagents, cron jobs, memory,
skills, a per-user file workspace, RAG over documents, code execution, web search
and a real browser. It has no runtime dependencies and knows nothing about HTTP, databases
or any product: you plug those in through small interfaces ("ports").

It powers [EagleDocs](../README.md), but the folder is self-contained: copy
`pixlai-engine/` into another project, implement the ports, and it works.

## Documentation

| Page | Read it for |
|---|---|
| [Getting started](docs/getting-started.md) | Install, a minimal model provider, the smallest working agent, a custom tool, handling events |
| [Concepts](docs/concepts.md) | The run loop, system prompt, events, run kinds, steering, approvals, cancellation, limits |
| [Ports](docs/ports.md) | The contract of every port, in-memory references, SQL guidance for several processes, writing a `ModelProvider` |
| [Tools](docs/tools.md) | `defineTool`, `ToolContext`, built-in tool catalog, `disableBuiltins`, `toolFilter`, planned tool packs |
| [Code, web and browser](docs/code-web-browser.md) | `code_run` over a `SandboxPort`, `web_search`/`web_fetch`/`web_download`, the browser pack and its approval policy, tool gates |
| [Workspace, files and RAG](docs/workspace-and-rag.md) | The files and rag packs, `WorkspacePort`, `TextExtractor`, `EmbeddingPort`, `SharedRagSource`, storage format |

## Quick start

```ts
import { createEngine, InMemoryRunStore, InMemoryMemoryStore, InMemorySkillStore, InMemoryScheduleStore } from 'pixlai-engine';

const engine = createEngine({
  stores: {
    runs: new InMemoryRunStore(),
    memory: new InMemoryMemoryStore(),
    skills: new InMemorySkillStore(),
    schedules: new InMemoryScheduleStore(),
  },
  basePrompt: 'You are Atlas, a helpful assistant.',
  tools: [/* your tools, see defineTool */],
});

// One isolated agent per user: own memory, skills, schedules and limits.
const agent = engine.forUser({ id: 'u1', name: 'Ana', language: 'es', timezone: 'America/New_York' });

const result = await agent.run({
  runId: 'run-1',
  model: { provider: myProvider, model: 'gpt-5', label: 'GPT-5', ref: 'openai:gpt-5', supportsTools: true, contextWindow: 272_000 },
  history: [{ role: 'user', content: 'What is on my calendar this week?' }],
  sink: { emit: (event) => sendToBrowser(event) },
});
```

## Ports

| Port | What the host provides |
|---|---|
| `ModelProvider` | `stream(request)` yielding `text`, `tool_call`, `usage` and `done` chunks. One per backend (Ollama, OpenAI-compatible, Anthropic...). The host picks the model per run. |
| `RunStore` | Steers (`takeSteers`, `watchSteers`) and approvals (`createApproval`, `waitForApproval`). Back it with a shared store (e.g. Postgres + LISTEN/NOTIFY) to run on several processes. |
| `MemoryStore` | Durable facts per user, and which ones go into the prompt. |
| `SkillStore` | Skills available to a user (index + full instructions + lessons learned). |
| `ScheduleStore` | The user's cron jobs. Running them when due is the host's job (see below). |
| `EventSink` | Where run events go (UI stream, logs). |
| `WorkspacePort` | Optional. The user's files, with quotas and areas (e.g. a `TEMP/` that expires). Enables the files pack. |
| `TextExtractor` | Optional. PDF, DOCX, PPTX... to text, page by page. |
| `EmbeddingPort` | Optional. Text embeddings; with a workspace it enables the rag pack. |
| `SharedRagSource` | Optional. Read-only RAGs built by someone else (e.g. an instructor). |
| `SandboxPort` | Optional. Runs code where the workspace is the working tree. Enables `code_run`. |
| `SearchPort`, `FetchPort` | Optional. Web search and safe downloads. Enable the web pack. |
| `BrowserPort`, `BrowserPolicy` | Optional. A real browser per user with cookie profiles, and which actions run, ask or are blocked. |
| `Logger`, `Clock` | Optional. |

`InMemory*Store` classes implement every store for tests and single-process hosts.

## Tools

```ts
const sendEmail = defineTool<{ to: string; body: string }>({
  name: 'email_send',                 // letters, digits, _ and -, up to 64 characters
  description: 'Send an email for the user',
  parameters: { type: 'object', properties: { to: { type: 'string' }, body: { type: 'string' } }, required: ['to', 'body'] },
  sideEffect: 'external',             // waits for the user's approval
  describe: (a) => ({ summary: `Send an email to ${a.to}`, details: { to: a.to } }),
  async run(args, ctx) { /* ... */ },
});
```

- `sideEffect: 'external'`: irreversible actions outside the user's workspace. Each call creates an approval and waits.
- `untrusted: true`: results come from third parties; they are wrapped in `<untrusted_content>` and the model is told never to follow instructions inside.
- `parallelSafe: true`: read-only; neighbouring safe calls run at the same time.
- `mainAgentOnly: true`: never offered to subagents.
- `timeoutMs`: overrides the default 60 s for tools that legitimately take minutes.
- `gate(args, ctx)`: per-call decision (`run`, `approve` or `{ refuse }`) when the risk depends on the arguments or the state.

Built-in tools: `time_now`, `memory_add`, `memory_search`, `memory_remove`, `skills_load`, `skills_note`,
`plan_update`, `ask_user`, `notify`, `calc`, `cron_create`, `cron_list`, `cron_update`, `cron_delete`,
`agent_delegate`. Turn any off with `disableBuiltins`, or narrow them per run with `toolFilter`
(see [Tools](docs/tools.md)).

With a `workspace`, the files pack adds `files_list`, `files_read`, `files_write`, `files_mkdir`,
`files_move`, `files_delete`, `files_search` and `files_usage`. With `embeddings` as well, the rag pack
adds `rag_list`, `rag_create`, `rag_add`, `rag_search`, `rag_ask` and `rag_delete`
(see [Workspace, files and RAG](docs/workspace-and-rag.md)). A `sandbox` adds `code_run`; `search` and `fetcher`
add `web_search`, `web_fetch` and `web_download`; a `browser` adds the `browser_*` tools
(see [Code, web and browser](docs/code-web-browser.md)).

## How a run works

1. The system prompt is built once per run (base prompt, user profile, memories, skills index, rules) and stays
   byte-identical for the whole run, so provider prompt caches keep working.
2. Loop: model, then tools, then model again, until it answers without tools. Every tool call gets exactly one
   result, even when it fails, times out or is skipped.
3. When the step or token budget runs out, a last call without tools asks for a final summary.
4. When the history nears 75% of the context window, old tool outputs are cleared first; if that is not enough,
   the middle of the conversation is summarized with the same model.

### Steering

A steer is a correction the user sends while the agent works ("only this semester"). The host stores it and the
engine picks it up:

- before every model call and after every tool batch, as a separate user message with an explicit marker the
  system prompt vouches for;
- if it arrives while the model is writing, that generation is cut short, the partial text is kept as context,
  and the model starts again with the correction (`interrupted` event);
- tools that are already running are never killed.

`steer_applied` is emitted for each one. Steers that arrive after the final answer stay in the store for the
host to treat as the next message.

### Subagents

`agent_delegate` runs up to `maxParallelSubagents` helpers at once, each with a fresh context. Helpers get
read-only tools only: no approvals, no memory writes, no schedules. They can delegate further until
`maxSubagentDepth`. Their events reach the sink wrapped in `{ type: 'subagent', parent_call_id, index, event }`,
and each returns a short report to the parent.

### Cron jobs

The agent manages the user's schedules with the `cron_*` tools. A schedule is a 5-field cron expression, an
interval (`every 2h`, at least 15 minutes) or an ISO date for a one-off, always evaluated in the user's timezone.
The host runs due schedules: find rows whose `nextRunAt` has passed, advance `nextRunAt` with `nextRun()` **before**
running (so a crash never double-runs), then call `agent.run({ kind: 'scheduled', ... })`. Scheduled runs cannot
create schedules, and an answer of exactly `[SILENT]` means there is nothing to report.

## Limits

```ts
engine.forUser(user, { limits: { maxSteps: 20, maxTokens: 0, maxSubagentDepth: 2, maxParallelSubagents: 3,
  maxSchedules: 10, toolTimeoutMs: 60_000, approvalTimeoutMs: 86_400_000 } });
```

## Development

```bash
npm install
npm test        # node:test via tsx, no network
npm run build   # dist/ with type declarations
```
