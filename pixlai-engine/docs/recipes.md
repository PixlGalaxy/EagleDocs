# Recipes

Working patterns for the things every host ends up building. They use only `node:` modules and the in-memory stores so they run as they are; swap the stores for your database when you deploy (see [Ports](ports.md#running-on-several-processes)).

## A chat server with streaming, steering, approvals and stop

One process, plain `node:http`, server-sent events for the stream. The browser posts a message, opens `/runs/:id/events`, and can send a correction, approve or reject a pending action, or stop the run while it works.

```ts
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import {
  createEngine, InMemoryMemoryStore, InMemoryRunStore, InMemoryScheduleStore, InMemorySkillStore,
  type ChatMessage, type EngineEvent, type ResolvedModel,
} from 'pixlai-engine';

const runs = new InMemoryRunStore();
const engine = createEngine({
  stores: { runs, memory: new InMemoryMemoryStore(), skills: new InMemorySkillStore(), schedules: new InMemoryScheduleStore() },
  basePrompt: 'You are Atlas, a helpful assistant.',
});
declare const model: ResolvedModel; // your provider, see getting-started.md

const histories = new Map<string, ChatMessage[]>(); // per conversation; use your database
const live = new Map<string, { events: EngineEvent[]; listeners: Set<(e: EngineEvent) => void>; stop: AbortController }>();

async function startRun(userId: string, chatId: string, text: string): Promise<string> {
  const runId = randomUUID();
  const history = [...(histories.get(chatId) ?? []), { role: 'user' as const, content: text }];
  const state = { events: [] as EngineEvent[], listeners: new Set<(e: EngineEvent) => void>(), stop: new AbortController() };
  live.set(runId, state);
  const agent = engine.forUser({ id: userId, name: 'Ana', language: 'en', timezone: 'America/New_York' });
  void agent
    .run({
      runId, model, history, signal: state.stop.signal,
      sink: { emit: (event) => { state.events.push(event); for (const l of state.listeners) l(event); } },
    })
    .then((result) => {
      // Keep everything the run produced: tool calls, results and applied steers included.
      histories.set(chatId, [...history, ...result.messages]);
      setTimeout(() => live.delete(runId), 60_000); // late reconnects can still replay
    });
  return runId;
}

const json = async (req: http.IncomingMessage) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : {};
};

http
  .createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const [, a, id, action] = url.pathname.split('/');
    const userId = 'u1'; // from your session

    if (req.method === 'POST' && a === 'chats' && action === 'messages') {
      const { text } = await json(req);
      res.end(JSON.stringify({ runId: await startRun(userId, id!, text) }));
    } else if (req.method === 'GET' && a === 'runs' && action === 'events') {
      const state = live.get(id!);
      if (!state) return void res.writeHead(404).end();
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const send = (e: EngineEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`);
      state.events.forEach(send); // replay what happened before the browser connected
      state.listeners.add(send);
      req.on('close', () => state.listeners.delete(send));
    } else if (req.method === 'POST' && a === 'runs' && action === 'steer') {
      const { text } = await json(req);
      res.end(JSON.stringify(runs.steer(id!, text))); // applied at the next safe point
    } else if (req.method === 'POST' && a === 'runs' && action === 'stop') {
      live.get(id!)?.stop.abort();
      res.writeHead(204).end();
    } else if (req.method === 'POST' && a === 'approvals') {
      const { approve } = await json(req);
      runs.decide(id!, approve ? 'approved' : 'rejected'); // check the approval belongs to this user first
      res.writeHead(204).end();
    } else res.writeHead(404).end();
  })
  .listen(3000);
```

What to change for production:

- Persist events with a sequence number and support `Last-Event-ID`, so a reconnect resumes instead of replaying everything.
- Run the agent in a job worker, not in the request handler, so a closed tab never stops it and any process can serve the stream.
- A steer sent after the final answer stays unapplied in the store: treat it as the next user message.

## Background delegation

Long research should not hold the chat. Pass `startBackground` and the agent can delegate with `background: true`; you run the helpers later and start a new turn with their reports.

```ts
import { backgroundReportMessage, type DelegateTask } from 'pixlai-engine';

const queue: { chatId: string; userId: string; tasks: DelegateTask[] }[] = [];

await agent.run({
  runId, model, history, sink,
  startBackground: async (tasks) => void queue.push({ chatId, userId, tasks }),
});

// Later, in a worker:
const job = queue.shift()!;
const helperAgent = engine.forUser(userProfileOf(job.userId));
const { reports } = await helperAgent.runSubagents({ runId: randomUUID(), model, tasks: job.tasks, sink: progressSink });
// Only when no other run of this chat is in progress, so the history stays in order:
const history = [...histories.get(job.chatId)!, { role: 'user' as const, content: backgroundReportMessage(reports) }];
await helperAgent.run({ runId: randomUUID(), model, history, sink });
```

Show `backgroundReportMessage` as a "reports" card, not as the user's words: it starts with a note saying it comes from the system.

## Running scheduled tasks

The agent creates schedules with the `cron_*` tools; your process runs them. Every minute, on one process only:

1. Select schedules whose `nextRunAt` has passed.
2. In the same transaction, set `nextRunAt` to `nextRun(parseSchedule(schedule), timezone, now, now)`, or disable one-offs. Advancing first means a crash never runs a schedule twice.
3. Start `agent.run({ kind: 'scheduled', history: [{ role: 'user', content: prompt }], ... })` in the schedule's own conversation.
4. If the answer is exactly `[SILENT]`, there was nothing to report: store it but do not notify.

A complete runner against `ScheduleStore` is in [Ports](ports.md#schedulestore).

## Per-user limits and tools

Plans, roles and organization settings all map to two knobs:

```ts
const agent = engine.forUser(user, {
  limits: plan === 'free' ? { maxSteps: 10, maxTokens: 200_000, maxSubagentDepth: 1 } : { maxSteps: 40 },
});

await agent.run({
  runId, model, history, sink,
  // Hide tools the organization switched off or the plan does not include.
  toolFilter: (tool) => !(org.emailDisabled && tool.name.startsWith('email_')),
});
```

`limits` apply to the whole run (subagents share the token budget). `toolFilter` removes tools from the model's view, so it never tries them.

## Choosing models

The engine never picks a model: you pass one per run, so routing, quotas and fallbacks stay in your code.

```ts
const model = text.length < 200 && !needsTools(text) ? models.fast : models.smart;
await agent.run({
  runId, model, history, sink,
  // Let the agent give each helper the model its task needs.
  helperModels: {
    list: [
      { ref: 'fast', label: 'Small local model', tags: ['fast'] },
      { ref: 'smart', label: 'Frontier model', tags: ['smart', 'code'] },
    ],
    resolve: async (choice) => (choice === 'fast' ? models.fast : choice === 'smart' || choice === 'code' ? models.smart : null),
  },
});
```

Providers should throw errors with a numeric `status` (and a `code` when the backend gives one): the engine retries dropped connections, 5xx and 429 (except `code: 'usage_limit_reached'`) twice before failing the run.

## Hermes-style memory with user edits

Let users read and edit SOUL.md, USER.md and MEMORY.md with the same rules as the agent:

```ts
import { applyOperations, DEFAULT_LIMITS } from 'pixlai-engine';

const docs = await stores.memory.read(userId);
const next = applyOperations('user', docs.user, [{ action: 'add', content: 'Works Tuesday nights' }], DEFAULT_LIMITS.userChars);
await stores.memory.write(userId, 'user', next);
```

Or let them replace a whole file from a text box, after checking its length against the limit.
