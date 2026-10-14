import { randomUUID } from 'crypto';
import type { ChatMessage, ModelChunk, ModelProvider, ModelRequest } from 'pixlai-engine';
import { errorFrom, ndjson } from './http.js';

interface OllamaChunk {
  message?: {
    content?: string;
    tool_calls?: { function: { name: string; arguments: Record<string, unknown> | string } }[];
  };
  done?: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
}

function toOllama(messages: ChatMessage[]) {
  return messages.map((m) => {
    if (m.role === 'tool') return { role: 'tool', content: m.content, tool_name: m.name };
    if (m.role === 'assistant' && m.toolCalls?.length) {
      return {
        role: 'assistant',
        content: m.content,
        tool_calls: m.toolCalls.map((c) => ({ function: { name: c.name, arguments: c.args } })),
      };
    }
    return { role: m.role, content: m.content };
  });
}

/** The EagleDocs model: an Ollama server set up by the admin (`/api/chat`, streaming NDJSON). */
export class OllamaProvider implements ModelProvider {
  constructor(private baseUrl: string, private contextWindow: number) {}

  async *stream(request: ModelRequest): AsyncIterable<ModelChunk> {
    const res = await fetch(`${this.baseUrl.replace(/\/+$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: request.signal,
      body: JSON.stringify({
        model: request.model,
        messages: toOllama(request.messages),
        ...(request.tools && {
          tools: request.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })),
        }),
        stream: true,
        // Reasoning models: keep the thinking out of the visible answer.
        think: false,
        options: { num_ctx: this.contextWindow },
      }),
    });
    if (!res.ok || !res.body) throw await errorFrom(res, 'Ollama');

    for await (const chunk of ndjson<OllamaChunk>(res.body)) {
      if (chunk.error) throw new Error(`Ollama: ${chunk.error}`);
      if (chunk.message?.content) yield { type: 'text', text: chunk.message.content };
      for (const call of chunk.message?.tool_calls ?? []) {
        const args = typeof call.function.arguments === 'string' ? JSON.parse(call.function.arguments || '{}') : call.function.arguments;
        // Ollama does not number calls; the engine needs an id to pair results.
        yield { type: 'tool_call', call: { id: `call_${randomUUID().slice(0, 8)}`, name: call.function.name, args: args ?? {} } };
      }
      if (chunk.done) {
        yield { type: 'usage', inputTokens: chunk.prompt_eval_count ?? 0, outputTokens: chunk.eval_count ?? 0 };
        yield { type: 'done' };
      }
    }
  }
}

export interface OllamaModelInfo {
  name: string;
  /** From /api/show when available. */
  contextWindow: number | null;
  supportsTools: boolean;
  supportsVision: boolean;
  /** An embedding model (for RAG), not a chat model. */
  isEmbedding: boolean;
}

/** Lists the models an Ollama server has pulled, with what each can do. */
export async function discoverOllamaModels(baseUrl: string): Promise<OllamaModelInfo[]> {
  const root = baseUrl.replace(/\/+$/, '');
  const res = await fetch(`${root}/api/tags`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw await errorFrom(res, 'Ollama');
  const { models } = (await res.json()) as { models: { name: string }[] };
  return Promise.all(
    models.map(async ({ name }) => {
      try {
        const show = await fetch(`${root}/api/show`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model: name }),
          signal: AbortSignal.timeout(10_000),
        });
        const info = (await show.json()) as { capabilities?: string[]; model_info?: Record<string, unknown>; parameters?: string };
        // The Modelfile's num_ctx is what the server owner chose (memory!); the architecture maximum is only a fallback.
        const numCtx = /(?:^|\n)\s*num_ctx\s+(\d+)/.exec(info.parameters ?? '')?.[1];
        const ctxKey = Object.keys(info.model_info ?? {}).find((k) => k.endsWith('.context_length'));
        return {
          name,
          contextWindow: numCtx ? Number(numCtx) : ctxKey ? Math.min(Number(info.model_info![ctxKey]), 32768) : null,
          supportsTools: info.capabilities?.includes('tools') ?? false,
          supportsVision: info.capabilities?.includes('vision') ?? false,
          isEmbedding: (info.capabilities?.includes('embedding') ?? false) || /embed/i.test(name),
        };
      } catch {
        return { name, contextWindow: null, supportsTools: false, supportsVision: false, isEmbedding: /embed/i.test(name) };
      }
    }),
  );
}
