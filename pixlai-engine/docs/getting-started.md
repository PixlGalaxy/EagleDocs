# Getting started

This page takes you from an empty project to an agent that answers a message, calls a tool and reports its events.

## Install

PixlAI-Engine is a local package with no runtime dependencies. It is ESM only and needs Node.js 20.3 or newer (it uses `AbortSignal.any`).

Build it once:

```bash
cd pixlai-engine
npm install
npm run build        # writes dist/ with type declarations
```

Then use it from your project in one of two ways:

```bash
# 1. Link the folder (the path is relative to your project)
npm install ../pixlai-engine

# 2. Or copy the pixlai-engine/ folder into your repository and import from it
```

Everything is imported from the package root:

```ts
import { createEngine, defineTool, InMemoryRunStore /* ... */ } from 'pixlai-engine';
```

## What you need to provide

The engine talks to the outside world only through ports (see [ports.md](ports.md)). For a first agent you need:

| Piece | For a first run |
|---|---|
| Four stores (`runs`, `memory`, `skills`, `schedules`) | The `InMemory*` classes that ship with the package |
| A `ModelProvider` | The small OpenAI-compatible one below |
| An `EventSink` | A function that prints events |

## A minimal model provider

A `ModelProvider` has one method, `stream(request)`, that yields chunks: `text`, `tool_call` (only when complete), `usage` and `done`. This one speaks the OpenAI-compatible `/chat/completions` streaming format, which many servers support (OpenAI, Ollama, vLLM, LM Studio and others).

```ts
import type { ChatMessage, ModelChunk, ModelProvider, ModelRequest } from 'pixlai-engine';

function toWire(m: ChatMessage) {
  if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
  if (m.toolCalls?.length) {
    return {
      role: 'assistant',
      content: m.content || null,
      tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })),
    };
  }
  return { role: m.role, content: m.content };
}

export function openAiCompatible(baseUrl: string, apiKey: string): ModelProvider {
  return {
    async *stream(request: ModelRequest): AsyncIterable<ModelChunk> {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        signal: request.signal,
        body: JSON.stringify({
          model: request.model,
          stream: true,
          stream_options: { include_usage: true },
          messages: request.messages.map(toWire),
          ...(request.tools && { tools: request.tools.map((t) => ({ type: 'function', function: t })) }),
        }),
      });
      if (!res.ok) throw new Error(`Model API ${res.status}: ${(await res.text()).slice(0, 300)}`);

      const calls = new Map<number, { id: string; name: string; args: string }>();
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop()!;
        for (const line of lines) {
          if (!line.startsWith('data: ') || line.slice(6).trim() === '[DONE]') continue;
          const json = JSON.parse(line.slice(6));
          const delta = json.choices?.[0]?.delta;
          if (delta?.content) yield { type: 'text', text: delta.content };
          for (const part of delta?.tool_calls ?? []) {
            const call = calls.get(part.index) ?? { id: '', name: '', args: '' };
            call.id = part.id ?? call.id;
            call.name = part.function?.name ?? call.name;
            call.args += part.function?.arguments ?? '';
            calls.set(part.index, call);
          }
          if (json.usage) yield { type: 'usage', inputTokens: json.usage.prompt_tokens, outputTokens: json.usage.completion_tokens };
        }
      }
      // Tool calls arrive in fragments: emit each one only when it is complete.
      for (const call of calls.values()) {
        yield { type: 'tool_call', call: { id: call.id, name: call.name, args: call.args ? JSON.parse(call.args) : {} } };
      }
      yield { type: 'done' };
    },
  };
}
```

This is a starting point. [ports.md](ports.md#writing-a-modelprovider) lists everything a production provider should handle.

## The smallest working agent

```ts
import {
  createEngine,
  InMemoryMemoryStore,
  InMemoryRunStore,
  InMemoryScheduleStore,
  InMemorySkillStore,
  type EngineEvent,
  type ResolvedModel,
} from 'pixlai-engine';
import { openAiCompatible } from './provider.js';

const engine = createEngine({
  stores: {
    runs: new InMemoryRunStore(),
    memory: new InMemoryMemoryStore(),
    skills: new InMemorySkillStore(),
    schedules: new InMemoryScheduleStore(),
  },
  basePrompt: 'You are Atlas, a concise and helpful assistant.',
});

// The host picks the model for every run.
const model: ResolvedModel = {
  provider: openAiCompatible('https://api.openai.com/v1', process.env.OPENAI_API_KEY!),
  model: 'gpt-5',            // name sent to the provider
  label: 'GPT-5',            // shown to the user
  ref: 'openai:gpt-5',       // opaque id for your own bookkeeping
  supportsTools: true,
  contextWindow: 272_000,    // tokens; compaction starts at 75% of this
};

// One agent per user. It is cheap: create it per request.
const agent = engine.forUser({ id: 'u1', name: 'Ana', language: 'en', timezone: 'America/New_York' });

const result = await agent.run({
  runId: 'run-1',
  model,
  history: [{ role: 'user', content: 'What time is it for me right now?' }],
  sink: { emit: (event: EngineEvent) => console.log(event.type) },
});

console.log(result.status);   // 'done'
console.log(result.content);  // the final answer
```

`history` is the conversation so far, oldest first, ending with the message to answer. Do not include a system message: the engine builds it.

## Reading the `RunResult`

`agent.run()` resolves in every case: model and tool failures do not make it throw. Check `status`:

| Field | Meaning |
|---|---|
| `status` | `'done'`, `'failed'` or `'cancelled'` |
| `content` | The final answer. Empty for `failed` and `cancelled`. |
| `messages` | Messages produced by this run (assistant turns, tool results, applied steers). Append them to your stored conversation. |
| `toolCalls` | Every tool call of this run with its final status and a 300-character preview of the result |
| `usage` | `{ inputTokens, outputTokens, steps }`; the token counts include subagents |
| `error` | Set when `status` is `'failed'` |
| `awaitingUser` | `true` when the run ended because the agent asked the user a question (`content` is the question) |

```ts
if (result.status === 'failed') console.error(result.error);
conversation.push(...result.messages);   // keep the steer flag when you store them
console.log(`${result.usage.steps} model calls, ${result.usage.inputTokens + result.usage.outputTokens} tokens`);
```

## Add a custom tool

```ts
import { defineTool } from 'pixlai-engine';

const weather = defineTool<{ city: string }>({
  name: 'weather_get',
  description: 'Current weather for a city',
  parameters: {
    type: 'object',
    properties: { city: { type: 'string', description: 'City name' } },
    required: ['city'],
  },
  sideEffect: 'none',       // read-only: runs without approval
  parallelSafe: true,       // may run alongside other safe calls
  async run(args, ctx) {
    const res = await fetch(`https://weather.example.com/v1?city=${encodeURIComponent(args.city)}`, { signal: ctx.signal });
    if (!res.ok) throw new Error(`Weather service answered ${res.status}`);  // the model sees { "error": "..." }
    return await res.json();                                                  // any JSON-serializable value
  },
});

const engine = createEngine({
  stores: { /* ... */ },
  basePrompt: 'You are Atlas, a concise and helpful assistant.',
  tools: [weather],
});
```

The engine does not validate arguments against `parameters`: validate them inside `run`. See [tools.md](tools.md) for every field.

## Handle events in the sink

The sink receives every event of a run, in order. Forward them to your UI (server-sent events, WebSocket) or log them.

```ts
import type { EngineEvent } from 'pixlai-engine';

function onEvent(event: EngineEvent) {
  switch (event.type) {
    case 'delta':
      process.stdout.write(event.text);                       // streamed answer text
      break;
    case 'tool_call':
      console.log(`\n[tool] ${event.call.name}(${JSON.stringify(event.call.args)}) ${event.call.status}`);
      break;
    case 'tool_result':
      console.log(`[tool] ${event.call.name} -> ${event.call.status}: ${event.call.result_preview}`);
      break;
    case 'approval_required':
      console.log(`[approval] ${event.approval.summary} (id ${event.approval.id})`);
      break;
    case 'interrupted':
      console.log('\n[answer cut short by a correction from the user]');
      break;
    case 'plan':
      console.log(event.steps.map((s) => `${s.status}: ${s.title}`).join('\n'));
      break;
  }
}
```

The full event list is in [concepts.md](concepts.md#events).

## Next steps

- [concepts.md](concepts.md): how a run works, steering, approvals, limits.
- [ports.md](ports.md): implement the stores and your own provider.
- [tools.md](tools.md): tool options, built-in tools, tool packs and roadmap.
- [recipes.md](recipes.md): a chat server with streaming, steering, approvals and stop, ready to adapt.
- [security.md](security.md): what to check before you give the agent tools that act outside.
- [skills.md](skills.md): teach the agent procedures without growing the prompt.
- [reference.md](reference.md): every export.
