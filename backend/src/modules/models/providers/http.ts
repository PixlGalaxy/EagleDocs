/** A failed call to a model API, with enough detail to decide whether to retry or trip a breaker. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Provider error code when there is one (e.g. "rate_limit_exceeded", "usage_limit_reached"). */
    readonly code?: string,
    /** The response looked like a Cloudflare challenge page, not the API. */
    readonly challenge = false,
  ) {
    super(message);
  }
}

/** Reads an error response into a ProviderError without dumping huge HTML pages into logs. */
export async function errorFrom(res: Response, provider: string): Promise<ProviderError> {
  const body = await res.text().catch(() => '');
  const challenge = /cf-chl|challenge-platform|Just a moment/i.test(body);
  let message = body.slice(0, 300);
  let code: string | undefined;
  try {
    const json = JSON.parse(body) as { error?: { message?: string; code?: string; type?: string } | string; detail?: unknown; message?: string };
    if (typeof json.error === 'string') message = json.error;
    else if (json.error) {
      message = json.error.message ?? message;
      code = json.error.code ?? json.error.type;
    } else if (typeof json.message === 'string') message = json.message;
    else if (json.detail) message = JSON.stringify(json.detail).slice(0, 300);
  } catch {
    // Not JSON: keep the excerpt.
  }
  return new ProviderError(`${provider} ${res.status}: ${challenge ? 'blocked by a Cloudflare challenge' : message}`, res.status, code, challenge);
}

/** Lines of a streaming body, decoded as UTF-8. */
async function* lines(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let index: number;
    while ((index = buffer.indexOf('\n')) >= 0) {
      yield buffer.slice(0, index).replace(/\r$/, '');
      buffer = buffer.slice(index + 1);
    }
  }
  buffer += decoder.decode();
  if (buffer) yield buffer;
}

/** Newline-delimited JSON (Ollama). */
export async function* ndjson<T>(body: ReadableStream<Uint8Array>): AsyncIterable<T> {
  for await (const line of lines(body)) {
    if (line.trim()) yield JSON.parse(line) as T;
  }
}

/** Server-sent events: yields each event's name and parsed JSON data. `[DONE]` ends the stream. */
export async function* sse<T>(body: ReadableStream<Uint8Array>): AsyncIterable<{ event: string; data: T }> {
  let event = 'message';
  let data = '';
  for await (const line of lines(body)) {
    if (line === '') {
      if (data) {
        if (data.trim() === '[DONE]') return;
        yield { event, data: JSON.parse(data) as T };
      }
      event = 'message';
      data = '';
    } else if (line.startsWith('event:')) {
      event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      data += (data ? '\n' : '') + line.slice(5).trimStart();
    }
  }
  if (data && data.trim() !== '[DONE]') yield { event, data: JSON.parse(data) as T };
}

/** Parses tool-call arguments that arrive as a JSON string; a model may send broken JSON. */
export function parseArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : { value };
  } catch {
    return { _raw: raw };
  }
}
