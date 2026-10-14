import type { ChatMessage, ModelChunk, ModelProvider, ModelRequest } from 'pixlai-engine';
import { errorFrom, parseArgs, sse } from './http.js';

export const ANTHROPIC_URL = 'https://api.anthropic.com';
const VERSION = '2023-06-01';
const MAX_TOKENS = 8192;

type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: Block[];
}

/**
 * Messages API shape: the system prompt is separate, roles must alternate and
 * tool results travel as user content. Consecutive same-role turns are merged.
 */
function toAnthropic(messages: ChatMessage[]): { system: string; messages: AnthropicMessage[] } {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const out: AnthropicMessage[] = [];
  const add = (role: 'user' | 'assistant', blocks: Block[]) => {
    if (blocks.length === 0) return;
    const last = out[out.length - 1];
    if (last && last.role === role) last.content.push(...blocks);
    else out.push({ role, content: blocks });
  };
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'tool') {
      add('user', [{ type: 'tool_result', tool_use_id: m.toolCallId ?? '', content: m.content }]);
    } else if (m.role === 'assistant') {
      add('assistant', [
        ...(m.content ? [{ type: 'text' as const, text: m.content }] : []),
        ...(m.toolCalls ?? []).map((c) => ({ type: 'tool_use' as const, id: c.id, name: c.name, input: c.args })),
      ]);
    } else {
      add('user', [{ type: 'text', text: m.content }]);
    }
  }
  return { system, messages: out };
}

interface Event {
  type: string;
  index?: number;
  message?: { usage?: { input_tokens?: number; output_tokens?: number } };
  content_block?: { type: string; id?: string; name?: string };
  delta?: { type?: string; text?: string; partial_json?: string };
  usage?: { output_tokens?: number };
  error?: { message?: string };
}

export class AnthropicProvider implements ModelProvider {
  constructor(private apiKey: string, private baseUrl = ANTHROPIC_URL) {}

  async *stream(request: ModelRequest): AsyncIterable<ModelChunk> {
    const { system, messages } = toAnthropic(request.messages);
    const res = await fetch(`${this.baseUrl.replace(/\/+$/, '')}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey, 'anthropic-version': VERSION },
      signal: request.signal,
      body: JSON.stringify({
        model: request.model,
        max_tokens: MAX_TOKENS,
        system,
        messages,
        ...(request.tools && {
          tools: request.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })),
        }),
        stream: true,
      }),
    });
    if (!res.ok || !res.body) throw await errorFrom(res, 'Anthropic');

    const blocks = new Map<number, { id: string; name: string; json: string }>();
    let inputTokens = 0;
    let outputTokens = 0;
    for await (const { data } of sse<Event>(res.body)) {
      switch (data.type) {
        case 'message_start':
          inputTokens = data.message?.usage?.input_tokens ?? 0;
          break;
        case 'content_block_start':
          if (data.content_block?.type === 'tool_use') {
            blocks.set(data.index!, { id: data.content_block.id ?? '', name: data.content_block.name ?? '', json: '' });
          }
          break;
        case 'content_block_delta':
          if (data.delta?.type === 'text_delta' && data.delta.text) yield { type: 'text', text: data.delta.text };
          if (data.delta?.type === 'input_json_delta') {
            const block = blocks.get(data.index!);
            if (block) block.json += data.delta.partial_json ?? '';
          }
          break;
        case 'content_block_stop': {
          const block = blocks.get(data.index!);
          if (block) yield { type: 'tool_call', call: { id: block.id, name: block.name, args: parseArgs(block.json || '{}') } };
          break;
        }
        case 'message_delta':
          outputTokens = data.usage?.output_tokens ?? outputTokens;
          break;
        case 'error':
          throw new Error(`Anthropic: ${data.error?.message ?? 'stream error'}`);
        default:
          break;
      }
    }
    yield { type: 'usage', inputTokens, outputTokens };
    yield { type: 'done' };
  }
}

export async function listAnthropicModels(apiKey: string): Promise<string[]> {
  const res = await fetch(`${ANTHROPIC_URL}/v1/models?limit=100`, {
    headers: { 'x-api-key': apiKey, 'anthropic-version': VERSION },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw await errorFrom(res, 'Anthropic');
  const json = (await res.json()) as { data?: { id: string }[] };
  return (json.data ?? []).map((m) => m.id);
}
