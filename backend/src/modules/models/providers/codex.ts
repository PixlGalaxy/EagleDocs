import { createHash } from 'crypto';
import type { ChatMessage, ModelChunk, ModelProvider, ModelRequest } from 'pixlai-engine';
import { errorFrom, parseArgs, sse, ProviderError } from './http.js';
import { accountInfo } from './codex-auth.js';

export const CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex';
/** Context window of the ChatGPT-account Codex backend (the API's is larger; this is the real limit here). */
export const CODEX_CONTEXT_WINDOW = 272_000;
/** Used when the models endpoint does not answer. */
export const FALLBACK_CODEX_MODELS = ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini'];

/** Our own client identity, never another product's. */
function identityHeaders(version: string): Record<string, string> {
  return { originator: 'eagledocs', 'user-agent': `EagleDocs/${version}` };
}

/** Gives the provider a valid access token, refreshing it (once, serialized) when needed. */
export type TokenSource = () => Promise<string>;

type InputItem =
  | { type: 'message'; role: 'user'; content: { type: 'input_text'; text: string }[] }
  | { type: 'message'; role: 'assistant'; status: 'completed'; content: { type: 'output_text'; text: string }[] }
  | { type: 'function_call'; call_id: string; name: string; arguments: string }
  | { type: 'function_call_output'; call_id: string; output: string };

/** Responses API input: typed content parts only (plain strings are rejected by this backend). */
function toInput(messages: ChatMessage[]): { instructions: string; input: InputItem[] } {
  const instructions = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const input: InputItem[] = [];
  const callId = (id: string) => id.slice(0, 64);
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'user') input.push({ type: 'message', role: 'user', content: [{ type: 'input_text', text: m.content }] });
    else if (m.role === 'tool') input.push({ type: 'function_call_output', call_id: callId(m.toolCallId ?? ''), output: m.content });
    else {
      if (m.content) input.push({ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: m.content }] });
      for (const call of m.toolCalls ?? []) {
        input.push({ type: 'function_call', call_id: callId(call.id), name: call.name, arguments: JSON.stringify(call.args) });
      }
    }
  }
  return { instructions, input };
}

interface StreamEvent {
  type: string;
  delta?: string;
  item?: { type: string; call_id?: string; name?: string; arguments?: string };
  response?: {
    usage?: { input_tokens?: number; output_tokens?: number };
    error?: { code?: string; message?: string };
    status?: string;
  };
  code?: string;
  message?: string;
  error?: { code?: string; message?: string };
}

/** ChatGPT subscription through the Codex backend (Responses API, streaming). */
export class CodexProvider implements ModelProvider {
  constructor(
    private token: TokenSource,
    private appVersion: string,
    /** Stable per user, so the backend can reuse its prompt cache. */
    private cacheScope: string,
  ) {}

  async *stream(request: ModelRequest): AsyncIterable<ModelChunk> {
    const accessToken = await this.token();
    const { accountId, residency } = accountInfo(accessToken);
    const { instructions, input } = toInput(request.messages);
    const tools = request.tools?.map((t) => ({ type: 'function', name: t.name, description: t.description, strict: false, parameters: t.parameters }));
    const cacheKey = `pck_${createHash('sha256')
      .update(`${this.cacheScope}\0${instructions}\0${JSON.stringify(tools ?? [])}`)
      .digest('hex')
      .slice(0, 24)}`;

    const res = await fetch(`${CODEX_BASE_URL}/responses`, {
      method: 'POST',
      signal: request.signal,
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream',
        authorization: `Bearer ${accessToken}`,
        ...(accountId && { 'chatgpt-account-id': accountId }),
        ...(residency && { 'x-openai-internal-codex-residency': residency }),
        'x-client-request-id': cacheKey,
        ...identityHeaders(this.appVersion),
      },
      body: JSON.stringify({
        model: request.model,
        instructions,
        input,
        ...(tools && { tools, tool_choice: 'auto', parallel_tool_calls: true }),
        store: false,
        stream: true,
        reasoning: { effort: 'medium', summary: 'auto' },
        include: [],
        prompt_cache_key: cacheKey,
      }),
    });
    if (!res.ok || !res.body) throw await errorFrom(res, 'ChatGPT');

    let finished = false;
    for await (const { data } of sse<StreamEvent>(res.body)) {
      switch (data.type) {
        case 'response.output_text.delta':
          if (data.delta) yield { type: 'text', text: data.delta };
          break;
        case 'response.output_item.done':
          // The finished item is authoritative for function calls.
          if (data.item?.type === 'function_call') {
            yield { type: 'tool_call', call: { id: data.item.call_id ?? '', name: data.item.name ?? '', args: parseArgs(data.item.arguments || '{}') } };
          }
          break;
        case 'response.completed':
        case 'response.incomplete':
          finished = true;
          yield {
            type: 'usage',
            inputTokens: data.response?.usage?.input_tokens ?? 0,
            outputTokens: data.response?.usage?.output_tokens ?? 0,
          };
          break;
        case 'response.failed': {
          const err = data.response?.error;
          throw new ProviderError(`ChatGPT: ${err?.message ?? 'the response failed'}`, 500, err?.code);
        }
        case 'error': {
          const code = data.code ?? data.error?.code;
          throw new ProviderError(`ChatGPT: ${data.message ?? data.error?.message ?? 'stream error'}`, code === 'usage_limit_reached' ? 429 : 500, code);
        }
        default:
          break;
      }
    }
    if (!finished) throw new ProviderError('ChatGPT: the response stream ended early', 502);
    yield { type: 'done' };
  }
}

/** Model slugs this ChatGPT account may use. */
export async function listCodexModels(accessToken: string, appVersion: string): Promise<string[]> {
  const { accountId } = accountInfo(accessToken);
  for (const clientVersion of ['99.0.0', '0.0.0']) {
    try {
      const res = await fetch(`${CODEX_BASE_URL}/models?client_version=${clientVersion}`, {
        headers: {
          authorization: `Bearer ${accessToken}`,
          ...(accountId && { 'chatgpt-account-id': accountId }),
          ...identityHeaders(appVersion),
        },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) continue;
      const json = (await res.json()) as { models?: { slug: string; priority?: number; visibility?: string }[] };
      const models = (json.models ?? [])
        .filter((m) => m.visibility !== 'hide' && m.visibility !== 'hidden')
        .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0) || a.slug.localeCompare(b.slug))
        .map((m) => m.slug);
      if (models.length) return models;
    } catch {
      // Try the next client version, then fall back.
    }
  }
  return FALLBACK_CODEX_MODELS;
}

/** Errors that mean OpenAI is pushing back on this kind of access, for the circuit breaker. */
export function isAccessBlock(err: unknown): boolean {
  if (!(err instanceof ProviderError)) return false;
  return err.challenge || err.status === 403 || (err.status === 401 && !/expired/i.test(err.message));
}
