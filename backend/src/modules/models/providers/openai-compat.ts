import type { ChatMessage, ModelChunk, ModelProvider, ModelRequest } from 'pixlai-engine';
import { errorFrom, parseArgs, sse } from './http.js';

interface Delta {
  choices?: {
    delta?: {
      content?: string | null;
      tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[];
    };
    finish_reason?: string | null;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
  error?: { message?: string };
}

function toOpenAI(messages: ChatMessage[]) {
  return messages.map((m) => {
    if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
    if (m.role === 'assistant' && m.toolCalls?.length) {
      return {
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })),
      };
    }
    if (m.role === 'user' && m.images?.length) {
      return {
        role: 'user',
        content: [
          ...(m.content ? [{ type: 'text', text: m.content }] : []),
          ...m.images.map((img) => ({ type: 'image_url', image_url: { url: `data:${img.mediaType};base64,${img.data}` } })),
        ],
      };
    }
    return { role: m.role, content: m.content };
  });
}

/**
 * OpenAI Chat Completions and every API that copies it: OpenAI, DeepSeek,
 * OpenRouter, Gemini's OpenAI endpoint, vLLM, LM Studio...
 */
export class OpenAICompatProvider implements ModelProvider {
  /** `guard` vets the address before each request (students' own APIs); guarded requests do not follow redirects. */
  constructor(private baseUrl: string, private apiKey: string | undefined, private label = 'API', private guard?: (url: string) => Promise<void>) {}

  async *stream(request: ModelRequest): AsyncIterable<ModelChunk> {
    await this.guard?.(this.baseUrl);
    const res = await fetch(`${this.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      ...(this.guard && { redirect: 'error' as const }),
      headers: {
        'content-type': 'application/json',
        ...(this.apiKey && { authorization: `Bearer ${this.apiKey}` }),
      },
      signal: request.signal,
      body: JSON.stringify({
        model: request.model,
        messages: toOpenAI(request.messages),
        ...(request.tools && {
          tools: request.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })),
        }),
        stream: true,
        stream_options: { include_usage: true },
        // OpenAI reasoning models; servers that do not know it ignore it.
        ...(request.reasoning && { reasoning_effort: request.reasoning === 'xhigh' ? 'high' : request.reasoning }),
      }),
    });
    if (!res.ok || !res.body) throw await errorFrom(res, this.label);

    // Tool calls arrive in pieces, keyed by index; they are complete when the stream ends.
    const calls = new Map<number, { id: string; name: string; args: string }>();
    for await (const { data } of sse<Delta>(res.body)) {
      if (data.error) throw new Error(`${this.label}: ${data.error.message ?? 'stream error'}`);
      const delta = data.choices?.[0]?.delta;
      if (delta?.content) yield { type: 'text', text: delta.content };
      for (const piece of delta?.tool_calls ?? []) {
        const call = calls.get(piece.index) ?? { id: '', name: '', args: '' };
        if (piece.id) call.id = piece.id;
        if (piece.function?.name) call.name += piece.function.name;
        if (piece.function?.arguments) call.args += piece.function.arguments;
        calls.set(piece.index, call);
      }
      if (data.usage) {
        yield { type: 'usage', inputTokens: data.usage.prompt_tokens ?? 0, outputTokens: data.usage.completion_tokens ?? 0 };
      }
    }
    for (const [index, call] of [...calls.entries()].sort(([a], [b]) => a - b)) {
      yield { type: 'tool_call', call: { id: call.id || `call_${index}`, name: call.name, args: parseArgs(call.args) } };
    }
    yield { type: 'done' };
  }
}

/** Model ids an OpenAI-compatible API offers (GET /models). Also proves the key works. */
export async function listOpenAIModels(baseUrl: string, apiKey: string | undefined, guard?: (url: string) => Promise<void>): Promise<string[]> {
  await guard?.(baseUrl);
  const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/models`, {
    ...(guard && { redirect: 'error' as const }),
    headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw await errorFrom(res, 'API');
  const json = (await res.json()) as { data?: { id: string }[] };
  return (json.data ?? []).map((m) => m.id).sort();
}
