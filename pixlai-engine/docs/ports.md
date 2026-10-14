# Ports

The engine knows nothing about databases, HTTP or model vendors. You plug those in through small interfaces. All types are exported from the package root.

| Port | Purpose | In-memory reference |
|---|---|---|
| `RunStore` | Steers and approvals of a run | `InMemoryRunStore` |
| `MemoryStore` | Durable facts per user | `InMemoryMemoryStore` |
| `SkillStore` | Skills available to a user | `InMemorySkillStore` |
| `ScheduleStore` | A user's scheduled tasks | `InMemoryScheduleStore` |
| `ModelProvider` / `ResolvedModel` | The LLM backend, chosen per run | none (see the [getting started](getting-started.md#a-minimal-model-provider) provider) |
| `EventSink` | Where run events go | a function you write |
| `WorkspacePort` | Optional: the user's files (enables the files pack) | `InMemoryWorkspace` |
| `TextExtractor` | Optional: documents to text, page by page | none (EagleDocs' is a reference) |
| `EmbeddingPort` | Optional: embeddings (with a workspace, enables the rag pack) | none |
| `SharedRagSource` | Optional: read-only RAGs from others | none |
| `Logger`, `Clock` | Optional: logging and time | console logger, `new Date()` |

The `InMemory*` classes keep state in the process and lose it on restart. They are for tests, demos and single-process hosts.

## RunStore

```ts
interface RunStore {
  takeSteers(runId: string): Promise<PendingSteer[]>;
  watchSteers(runId: string, onSteer: () => void): () => void;
  createApproval(input: { runId; userId; toolName; args; summary; details }): Promise<{ id: string }>;
  waitForApproval(approvalId: string, timeoutMs: number, signal: AbortSignal): Promise<ApprovalDecision>;
}
type ApprovalDecision = 'approved' | 'rejected' | 'expired';
interface PendingSteer { id: string; content: string }
```

| Method | Contract |
|---|---|
| `takeSteers(runId)` | Returns the steers for this run that were not applied yet, oldest first, and marks them applied **atomically**: two concurrent calls must never return the same steer, and a steer must not be lost if the process dies right after. Returns `[]` when there are none. Called before every model call. |
| `watchSteers(runId, onSteer)` | Calls `onSteer()` **promptly** (well under a second) when a new steer for this run exists. Returns an unsubscribe function that must stop all callbacks. It does not hand over the steer: the engine then reads it with `takeSteers`. Called around each model generation. |
| `createApproval(input)` | Stores a pending approval for the run and returns its id. `summary` and `details` are what you show to the user. |
| `waitForApproval(id, timeoutMs, signal)` | Resolves with the user's decision. It must also resolve when `timeoutMs` passes (`'expired'`) and when `signal` aborts (any value; the engine checks the signal first). It must never hang. An unknown id should resolve `'expired'`. If the decision was already made before the call, resolve immediately. |

`InMemoryRunStore` also has two host-side helpers that are not part of the port: `steer(runId, content)` stores a steer and notifies watchers, and `decide(approvalId, decision)` answers an approval (the first decision wins). The `created` array lists every approval created, which is handy in tests.

```ts
const runs = new InMemoryRunStore();
// In your HTTP handlers:
runs.steer('run-1', 'only the last month');
runs.decide(approvalId, 'approved');
```

## MemoryStore

```ts
interface MemoryStore {
  add(userId: string, content: string, source: 'agent' | 'user'): Promise<MemoryItem>;
  remove(userId: string, id: string): Promise<boolean>;
  search(userId: string, query: string, limit: number): Promise<MemoryItem[]>;
  forPrompt(userId: string, latestUserMessage: string, limit: number): Promise<MemoryItem[]>;
}
interface MemoryItem { id: string; content: string; createdAt: string }
```

| Method | Contract |
|---|---|
| `add` | Saves a fact for this user. `source` says whether the agent or the user created it. Returns the stored item. |
| `remove` | Deletes the item only if it belongs to `userId`. Returns whether something was deleted. |
| `search` | Items of this user relevant to `query`, at most `limit` (the tool uses 10). Substring, full-text or vector search are all fine. |
| `forPrompt` | The most useful items for the prompt of this run, at most `limit` (the engine uses 20). Called once per run. `latestUserMessage` lets you rank by relevance. |

Always scope by `userId`. The in-memory version matches any query word as a substring and returns the newest items for the prompt.

## SkillStore

```ts
interface SkillStore {
  list(userId: string): Promise<SkillSummary[]>;
  load(userId: string, slug: string): Promise<{ name: string; body: string; notes: string[] } | null>;
  addNote(userId: string, slug: string, note: string): Promise<void>;
}
interface SkillSummary { slug: string; name: string; description: string }
```

| Method | Contract |
|---|---|
| `list` | Skills enabled for this user. Only `slug`, `name` and `description` go into the system prompt, so keep descriptions short. Called once per run. |
| `load` | Full instructions (`body`) and the lessons learned (`notes`) of one skill, or `null` when the skill does not exist or is not available to this user. |
| `addNote` | Stores a short lesson to show the next time the skill loads. |

```ts
const skills = new InMemorySkillStore([
  { slug: 'weekly-report', name: 'Weekly report', description: 'Write the weekly status report', body: '1. Collect ...' },
]);
```

## ScheduleStore

```ts
interface ScheduleStore {
  list(userId: string): Promise<Schedule[]>;
  create(userId: string, input: Omit<Schedule, 'id' | 'lastRunAt'>): Promise<Schedule>;
  update(userId: string, id: string, patch: Partial<Omit<Schedule, 'id'>>): Promise<Schedule | null>;
  remove(userId: string, id: string): Promise<boolean>;
}
interface Schedule {
  id: string; name: string; schedule: string; timezone: string; prompt: string;
  enabled: boolean; nextRunAt: string | null; lastRunAt: string | null;
}
```

`update` returns `null` when the id is unknown for this user and `remove` returns whether a row was deleted. `nextRunAt` and `lastRunAt` are ISO strings.

The store only holds data. **Running due schedules is the host's job.** The port has no "list everything that is due" method because that query spans users; run it against your own database. For each due schedule, move `nextRunAt` forward **before** running, so a crash never runs the same task twice:

```ts
import { nextRun, parseSchedule, type ResolvedModel, type Schedule, type ScheduleStore, type UserAgent } from 'pixlai-engine';

async function runDue(schedule: Schedule, agent: UserAgent, model: ResolvedModel, store: ScheduleStore) {
  const now = new Date();
  const next = nextRun(parseSchedule(schedule.schedule), schedule.timezone, now, schedule.lastRunAt ? new Date(schedule.lastRunAt) : null);
  await store.update(agent.user.id, schedule.id, {
    lastRunAt: now.toISOString(),
    nextRunAt: next?.toISOString() ?? null,
    enabled: next !== null,              // a one-off is done after its run
  });
  const result = await agent.run({
    runId: `schedule-${schedule.id}-${now.getTime()}`,
    kind: 'scheduled',
    model,
    history: [{ role: 'user', content: schedule.prompt }],
    sink: { emit: () => undefined },
  });
  if (result.status === 'done' && result.content.trim() !== '[SILENT]') await deliverToUser(agent.user.id, result.content);
}
```

`deliverToUser` is yours (email, push, inbox).

## EventSink

```ts
interface EventSink { emit(event: EngineEvent): void | Promise<void> }
```

Receives every event in order (see [concepts.md](concepts.md#events)). The engine awaits it, so keep it fast: write to a queue or a stream and return. Do not throw: a throwing sink fails the run. Events from tools running in parallel can interleave.

## Logger and Clock

```ts
interface Logger { info(message: string): void; warn(message: string): void; error(message: string, detail?: unknown): void }
interface Clock { now(): Date }
```

Both are optional in `createEngine`. The default logger writes to the console with a `[pixlai-engine]` prefix; the default clock is `new Date()`. The engine uses the clock for the date line in the prompt, `time_now` and schedule planning. Pass a fixed clock in tests.

## ModelProvider and ResolvedModel

```ts
interface ModelProvider { stream(request: ModelRequest): AsyncIterable<ModelChunk> }

interface ModelRequest { model: string; messages: ChatMessage[]; tools?: ToolSpec[]; signal: AbortSignal }

type ModelChunk =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; call: { id: string; name: string; args: Record<string, unknown> } }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'done' };

interface ResolvedModel {
  provider: ModelProvider;
  model: string;          // name sent to the provider
  label: string;          // shown to the user
  ref: string;            // opaque id for the host
  supportsTools: boolean; // false: the engine sends no tools
  contextWindow: number;  // tokens; compaction starts at 75%
}
```

The host chooses the model for every run (routing, quotas, fallbacks). The engine never retries or switches models.

### Writing a ModelProvider

A working example is in [getting-started.md](getting-started.md#a-minimal-model-provider). Requirements:

**Messages you receive** (`request.messages`, in order):

| Message | Fields | Map it to |
|---|---|---|
| First message | `role: 'system'` | The provider's system prompt |
| User turns | `role: 'user'`, `content` | A user message |
| Assistant turns | `role: 'assistant'`, `content` (may be empty), `toolCalls?: { id, name, args }[]` | An assistant message; when `toolCalls` is set, include the tool calls with `args` serialized as the provider expects |
| Tool results | `role: 'tool'`, `toolCallId`, `name`, `content` | A tool result linked to `toolCallId` (some providers also want `name`) |
| Steers | `role: 'user'`, `steer: true` | A normal user message. The engine has **already** wrapped `content` in the out-of-band marker; do not add or strip anything. |

Things that can happen in a valid history:

- Two `user` messages in a row (a steer after a plain user turn, or a compaction summary). If your API requires alternating roles, merge them.
- Several tool results in a row, one per call of the previous assistant message.
- The final call after a budget limit has no `tools` but the history may still contain tool calls. If your API rejects that, convert tool calls and results to plain text when `request.tools` is missing.
- Compaction sends a separate request with only a system message and a user message, and no tools. Only `text` chunks are read from it.

**Streaming:**

- Yield `text` chunks as they arrive. The engine forwards each one as a `delta` event. Do not yield hidden reasoning as `text` unless you want users to see it.
- Yield a `tool_call` only when it is complete: id, name and fully parsed `args`. Assemble streamed fragments first. Ids must be non-empty and unique within the response; generate one (for example `crypto.randomUUID()`) when the backend gives none. If the arguments are not valid JSON, yielding `args: {}` lets the tool report the missing fields so the model can retry.
- Yield `usage` once per request, at the end, with the totals. Usage feeds `RunResult.usage`, `usage` events and `limits.maxTokens`. If you never yield it, those stay at 0.
- `done` is optional and ignored by the engine.
- Omit the `tools` parameter when `request.tools` is undefined.

**Abort signal:**

- Pass `request.signal` to your HTTP request, or check it between chunks. When it aborts (cancellation, or a steer that interrupts a generation), stop. Throwing an abort error or ending the stream silently are both fine: the engine checks its own state afterwards.
- Do not swallow other errors. A thrown error ends the run with `status: 'failed'` and its message in `error` (cut to 600 characters), so keep secrets out of error messages.

## Running on several processes

The engine is stateless, so scaling out means sharing the stores. The parts that need care are in `RunStore`, because a steer or an approval is created in one process (your HTTP handler) and consumed in another (the one running the loop).

A SQL sketch:

```sql
CREATE TABLE run_steers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id     text NOT NULL,
  content    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz
);
CREATE INDEX ON run_steers (run_id) WHERE applied_at IS NULL;

CREATE TABLE run_approvals (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id     text NOT NULL,
  user_id    text NOT NULL,
  tool_name  text NOT NULL,
  args       jsonb NOT NULL,
  summary    text NOT NULL,
  details    jsonb NOT NULL,
  decision   text,                 -- null while pending
  created_at timestamptz NOT NULL DEFAULT now()
);
```

**takeSteers** must be one statement so the "mark applied" step is atomic:

```sql
WITH next AS (
  SELECT id FROM run_steers
  WHERE run_id = $1 AND applied_at IS NULL
  FOR UPDATE SKIP LOCKED
)
UPDATE run_steers s SET applied_at = now()
FROM next WHERE s.id = next.id
RETURNING s.id, s.content, s.created_at;   -- sort by created_at in code
```

**watchSteers** needs a wake-up signal plus a safety net:

- On insert, the handler runs `NOTIFY run_steer, '<run_id>'`. Each process keeps one `LISTEN run_steer` connection and a map from run id to callbacks.
- Also poll every 1 to 2 seconds (`SELECT 1 FROM run_steers WHERE run_id = $1 AND applied_at IS NULL`). Notifications are lost while a listener connection is down, so polling keeps behaviour correct after a reconnect.
- When a watcher is registered, check once immediately: a steer inserted between `takeSteers` and the subscription would otherwise wait for the next poll.
- The unsubscribe function must clear the poll timer and the map entry.

**createApproval** inserts a row with a null `decision` and returns its id. **waitForApproval** has to survive page refreshes and other processes:

- The user's decision is an `UPDATE run_approvals SET decision = $2 WHERE id = $1 AND decision IS NULL` made by the HTTP handler, followed by `NOTIFY run_approval, '<id>'`. The first decision wins; later calls are no-ops, so double clicks and repeated requests are harmless.
- The waiter checks the row first (the decision may already exist), then waits on `LISTEN run_approval` with a poll as fallback.
- On timeout, run `UPDATE ... SET decision = 'expired' WHERE id = $1 AND decision IS NULL RETURNING decision` and return what the row holds, in case a decision landed at the same moment.
- On abort, stop waiting and clear timers. Leave the row alone or mark it `'rejected'`.
- Because pending approvals live in the table, a page that reloads can list them by `run_id` and show them again. The in-flight `waitForApproval` is held by the process running the loop, so if that process dies, the run is gone: mark its pending approvals as `'expired'` on your own recovery path.

Other things a multi-process host owns: routing cancellation to the process that holds the run's `AbortController` (the same `NOTIFY` pattern works), and making sure two processes never run the same `runId` at once.

## Workspace, extractor, embeddings and shared RAGs

These four optional ports have their own page: [Workspace, files and RAG](workspace-and-rag.md).
