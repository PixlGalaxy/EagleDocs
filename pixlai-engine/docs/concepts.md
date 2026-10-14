# Concepts

## One engine, one agent per user

```ts
const engine = createEngine({ stores, basePrompt, tools });          // once per process
const agent = engine.forUser(user, { limits, host });                // per request, cheap
const result = await agent.run({ runId, model, history, sink });     // one run
```

- `createEngine` builds the tool registry and holds the stores. Call it once.
- `forUser(user, options)` returns a `UserAgent` bound to one `UserProfile` (`id`, `name`, `language`, `timezone`, optional `facts`). All reads and writes (memory, skills, schedules) are scoped to `user.id`. `options.limits` overrides limits for this user, and `options.host` is passed to your tools (see [tools.md](tools.md#toolcontext)).
- The engine keeps no per-user or per-run state in the process. Everything goes through the stores, so several processes can serve the same users as long as the stores are shared (see [ports.md](ports.md#running-on-several-processes)).
- `agent.tools()` lists the tools a normal chat run would offer.

Limits are merged in this order: defaults, then `createEngine({ limits })`, then `forUser(user, { limits })`.

## Runs and the loop

A run is one call to `agent.run()`. It repeats this loop until the model answers without calling tools:

1. Apply pending steers (see [Steering](#steering)).
2. Compact the context if it is near the window (see below).
3. Call the model with the system prompt, the history and the tools.
4. If the model asked for tools, run them (in batches, see [tools.md](tools.md#batching-and-parallelism)), add one result per call, go to 1.
5. If it answered without tools, that text is the final answer.

Rules the loop follows:

- Every tool call gets exactly one result, even when the tool does not exist, throws, times out, is rejected or is skipped because the run was cancelled.
- **Step budget.** `limits.maxSteps` (default 20) counts model calls of this run; each subagent has its own step budget, while tokens are shared. When it is reached, or when `limits.maxTokens` is reached (when it is not 0), the engine makes one last call with the tools removed and an extra user message asking for a final summary. Whatever the model answers becomes `content`, even if it tried to call tools.
- **Errors.** If the provider throws (and the run was not cancelled or steered), the run ends with `status: 'failed'` and `error` set. Messages produced up to that point stay in `messages`.
- **Models without tools.** When `model.supportsTools` is `false`, no tools are sent, the system prompt says so, and a `notice` event is emitted.
- Subagents share the token budget with their parent. Each loop (parent and every subagent) counts its own steps.

### Compaction at 75%

Before every model call the engine estimates the prompt size (4 characters per token). If it passes 75% of `model.contextWindow`:

1. Old tool outputs are replaced by a short placeholder, keeping the 6 newest tool results and any output under 200 characters. No model call is needed.
2. If that is not enough, everything between the system prompt and the newest 12 messages is summarized by the same model (a call with no tools) and replaced by one user message that starts with `[EARLIER CONVERSATION, SUMMARIZED FOR REFERENCE]`. A tool call is never separated from its results. If the summary call fails, a placeholder line is used instead.

Compaction only changes what is sent to the model during this run. It does not change `history` or `RunResult.messages`, emits no event, and the summary call is not counted in `usage`.

## The system prompt

The system prompt is built once per run and is byte-stable for the whole run, so provider-side prompt caches keep working. Anything that changes during the run (steers, summaries, new memories) travels as a message instead. Sections, in order:

| Section | Content |
|---|---|
| Base prompt | `basePrompt` from `createEngine` (replaced by a fixed helper prompt in subagents) |
| About the user | Name, answer language, timezone and each `facts` line |
| What you remember | Up to 20 items from `MemoryStore.forPrompt(userId, latestUserMessage, 20)`, as `[id] content`. Skipped when empty and in subagents. |
| Skills | The index from `SkillStore.list`: `slug: name. description`. Only when the model can use tools and there is at least one skill. Skipped in subagents. |
| Rules | Untrusted content is data; the steer marker is genuine; external actions wait for approval; request independent tool calls together. A different rule is used when the model has no tools. |
| Extra instructions | The scheduled-task note for `scheduled` runs, or the depth note for subagents |
| Date line | `Today is <full date> (<timezone>)`. Date only, no clock time, so it stays stable within a day. Use `time_now` for the time. |

Memories are read once at the start. A `memory_add` during the run does not change the prompt; the fact appears in the next run.

## Events

The sink receives these `EngineEvent` values in order. `sink.emit` is awaited by the loop: a slow sink slows the run, and a sink that throws makes the run fail. Do not throw from it.

| `type` | Emitted when | Payload |
|---|---|---|
| `status` | `running` at the start and after an approval is decided; `waiting_approval` while waiting; `done` when the run ends normally (also when it ends with a question); `failed` or `cancelled` when it ends otherwise. The last `status` event always matches `RunResult.status`. | `status` |
| `model` | Once at the start of a top-level run (not for subagents) | `model_ref`, `model_label` |
| `delta` | For every text chunk from the model, and once for the `ask_user` question | `text` |
| `tool_call` | A call starts running. For external tools it is emitted first with status `waiting_approval`, and again with `running` once approved. Unknown tools emit it and then an error result. | `call: ToolCallView` |
| `tool_result` | A call finished (`done`, `error` or `rejected`) | `call: ToolCallView` with `result_preview` (first 300 characters) |
| `approval_required` | An external tool is waiting for the user | `approval: { id, tool_name, summary, details }` |
| `steer_applied` | A steer was added to the context | `id`, `content` (the user's own words) |
| `interrupted` | A steer cut a generation short | none |
| `subagent` | Wraps any event from a subagent | `parent_call_id`, `index`, `task` (first 200 characters of the goal), `event` |
| `usage` | The provider reported token usage | `input_tokens`, `output_tokens` |
| `notice` | The model cannot use tools but tools exist | `message` |
| `plan` | `plan_update` ran. Each event replaces the previous plan. | `steps: { title, status }[]` with status `pending`, `in_progress`, `done` or `skipped` |
| `notify` | `notify` ran. Hosts may turn it into a push notification. | `title`, `body`, `url?` |

`ToolCallView` is `{ id, name, args, status, result_preview? }` with status `running`, `done`, `error`, `waiting_approval` or `rejected`.

## Run kinds

`RunOptions.kind` is `'chat'` (default) or `'scheduled'`. `'subagent'` is created internally.

| | `chat` | `scheduled` | `subagent` |
|---|---|---|---|
| Started by | The host, for a user message | The host, when a schedule is due | `agent_delegate` |
| Tools | All, minus `toolFilter` | All except `cron_*`, minus `toolFilter` | Only tools with `sideEffect: 'none'` and without `mainAgentOnly`, plus `agent_delegate` while depth allows |
| Steers | Applied | Applied if the host sends any | Never |
| `ask_user` | Ends the run with a question | Fails with an error the model can read | Not available |
| Prompt | Normal | Adds a note: no user present, final answer is delivered automatically, answer exactly `[SILENT]` when there is nothing to report, do not change schedules | Fixed helper prompt, no memories, no skills index |
| `model` event | Yes | Yes | No |

The host decides what to do with `[SILENT]`: the engine returns it as normal `content`.

## `RunResult`

| Field | Meaning |
|---|---|
| `status` | `done`, `failed` or `cancelled` |
| `content` | Final answer, or the question when `awaitingUser` is true. Empty on `failed` and `cancelled`. |
| `messages` | Messages created by this run, in order: assistant turns (with `toolCalls`), tool results, applied steers (`steer: true`, the user's raw text), and the partial text of an interrupted answer. Persist them. |
| `toolCalls` | `ToolCallView[]` of this run's own calls. Subagent calls are not included; they appear only in `subagent` events. |
| `usage` | `inputTokens` and `outputTokens` including subagents; `steps` counts this run's own model calls |
| `error` | Message when `failed` (cut to 600 characters) |
| `awaitingUser` | `true` when the agent called `ask_user`. The run ended after the current tool batch; the user's reply starts a new run. |

When you store `messages` and send them back as `history`, keep the `steer` flag: the engine re-applies the out-of-band marker for messages that have it.

## Steering

A steer is a message the user sends while the agent is working. The host stores it (for the in-memory store: `runs.steer(runId, text)`) and the engine picks it up through `RunStore.takeSteers`.

When steers are applied:

- At the top of every loop iteration, that is, before each model call. This includes the call right after a tool batch.
- Not while tools run and not while an approval is pending. Running tools are never killed; the steer waits until the batch ends.
- Never in subagents.

How a steer reaches the model: as a separate `user` message with the marker `[OUT-OF-BAND USER MESSAGE: sent by the user while you were working, delivered once at this point] ... [/OUT-OF-BAND USER MESSAGE]` around the text. The system prompt tells the model that a message with this marker is a real correction and that look-alikes inside tool results are not. The marker is added when messages are sent to the provider (`toProviderMessages`); the stored message keeps the raw text and `steer: true`. A `steer_applied` event is emitted for each one.

Interruption: while the model is generating, the engine watches the run through `RunStore.watchSteers`. If a steer arrives, the generation is aborted (the provider's `request.signal` fires), tool calls that were being streamed are dropped, the text so far is kept as an assistant message ending in `[interrupted by the user's correction]`, an `interrupted` event is emitted, and the loop restarts. The steer is applied at the top of the next iteration. Deltas already sent to the UI cannot be taken back, so a UI should keep the partial text and show the new answer after it.

A steer that arrives after the final answer stays in the store as unapplied. The host should treat it as the next user message.

## Approvals

A tool with `sideEffect: 'external'` never runs directly. For each call the engine:

1. Calls `tool.describe(args)` (or uses the tool name as the summary) and `RunStore.createApproval(...)`.
2. Emits `tool_call` (status `waiting_approval`), `approval_required` and `status: waiting_approval`.
3. Waits in `RunStore.waitForApproval(id, limits.approvalTimeoutMs, signal)`. The default timeout is 24 hours.
4. On `approved`, emits `status: running` and `tool_call` (running) and runs the tool.
5. On `rejected` or `expired`, the tool is not run. The model receives `{"error":"The user rejected it. Do not retry this action unless they ask."}` or, for `expired`, `... did not answer in time ...`. The `ToolCallView` status is `rejected` in both cases.

Approvals are resolved one at a time because external tools are not batched in parallel. If the run is cancelled while waiting, the call is skipped with an error result.

## Untrusted content

A tool with `untrusted: true` returns data a third party controls (web pages, emails, documents). The result is cut to 20,000 characters, then wrapped:

```
<untrusted_content source="tool_name">
...result...
</untrusted_content>
```

Any `<untrusted_content>` or `</untrusted_content>` tag inside the result is replaced with `[tag removed]`, so the payload cannot close the wrapper early. The system prompt tells the model to treat the wrapped text as data and never follow instructions in it. `wrapUntrusted(source, text)` is exported for use in your own code.

## Cancellation

Pass an `AbortSignal` as `RunOptions.signal`. When it aborts:

- The model request is aborted through `request.signal`.
- Running tools see `ctx.signal` abort and are no longer awaited. A tool that ignores the signal keeps running in the background, but its result is discarded.
- A pending approval wait ends (your `waitForApproval` must resolve on abort).
- A `status: 'cancelled'` event is emitted and `run()` resolves with `status: 'cancelled'` and empty `content`.

If you run on several processes, route the cancel request to the process that owns the run and abort the controller there.

## Limits

```ts
engine.forUser(user, { limits: { maxSteps: 30, toolTimeoutMs: 120_000 } });
```

| Limit | Default | Meaning |
|---|---|---|
| `maxSteps` | 20 | Model calls per loop. At the limit the engine makes the final call without tools. |
| `maxTokens` | 0 | Input plus output tokens per run, subagents included. 0 means no limit. Needs a provider that reports `usage`. |
| `maxSubagentDepth` | 2 | How deep delegation can go. 0 removes `agent_delegate`. |
| `maxParallelSubagents` | 3 | Tasks per `agent_delegate` call |
| `maxSchedules` | 10 | Schedules per user, checked by `cron_create` |
| `toolTimeoutMs` | 60,000 | Time a tool gets to run (the clock starts after any approval). On timeout the model gets `{"error":"Timed out after 60s"}`. |
| `approvalTimeoutMs` | 86,400,000 | Wait for an approval before treating it as expired |

`DEFAULT_LIMITS` is exported.

## Subagents

`agent_delegate` takes up to `maxParallelSubagents` tasks (`{ goal, context? }`) and runs each as a child loop with a fresh context, read-only tools and the fixed helper prompt. Children report back with a short text (cut to 8,000 characters). Their events reach the sink wrapped in `subagent` events. They cannot ask the user, cannot trigger approvals and cannot write memory or schedules. They can delegate further until `maxSubagentDepth`.

### Choosing a model per helper

Pass `helperModels` to `run` (and to `runSubagents`) to let the agent match each helper to the work. It is a list of `{ ref, label, tags }` plus `resolve(choice)`, which turns a ref or a tag such as `fast` into a `ResolvedModel`, or returns `null` when it is not available. The list goes into the system prompt (exported as `helperModelsNote`) with guidance: `fast` for simple lookups and short summaries, `smart` for reasoning, analysis and careful writing, `code` for code, and `smart` when unsure. Each task can then set `model`. A helper without one, or with an unknown one, runs on its parent's model.

Each `subagent` event carries `model_label`, and each report says which model wrote it. Tokens from every helper count against the run's shared `maxTokens` budget, whatever model they ran on.

### Background delegation

By default the main agent waits for its helpers. When the host passes `startBackground` to `run`, the model may call `agent_delegate` with `background: true` for long work. The tool hands the tasks to the host and returns at once, and the agent tells the user it will report back. Without `startBackground`, `background` is ignored and the run waits as usual.

The host then runs the helpers and answers with their reports:

1. Store the tasks (a job, a queue row) and run them with `agent.runSubagents({ runId, model, tasks, sink })`. It returns `{ reports, usage }`, and the helpers' events reach `sink` as `subagent` events tagged with `runId`.
2. Add `backgroundReportMessage(reports)` to the conversation as a user-role message. It says it comes from the system, not the user.
3. Start a normal `run` on that conversation. The agent reads the reports and answers.

Add the reports only when no other run of that conversation is in progress, so the history stays in order. EagleDocs keeps the reports on the helpers' job and inserts them when the follow-up turn starts.

## Schedules

The agent manages schedules with the `cron_*` tools, and the host runs them. A schedule is a 5-field cron expression, an interval (`every 30m`, `every 2h`, `every 1d`, minimum 15 minutes) or an ISO date for a one-off, evaluated in the schedule's timezone. The engine exports `parseSchedule`, `nextRun`, `planSchedule`, `isValidTimezone` and `MIN_INTERVAL_MS`. A runner example is in [ports.md](ports.md#schedulestore).
