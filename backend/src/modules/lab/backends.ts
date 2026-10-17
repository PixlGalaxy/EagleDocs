/**
 * The Accelerator Lab's GPU servers. They live on the private Docker network, only the lab worker
 * calls them, and nothing here knows about users or queues.
 */

/** Long enough for a cold model load on a small GPU plus one answer. */
const CALL_TIMEOUT_MS = 10 * 60_000;

export interface Segment {
  start: number;
  end: number;
  text: string;
}

async function failure(res: Response, what: string): Promise<Error> {
  const body = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300);
  return new Error(`${what} answered ${res.status}${body ? `: ${body}` : ''}`);
}

const base = (url: string) => url.trim().replace(/\/+$/, '');

/** One Ollama chat turn without streaming; `images` are base64 (no data: prefix). */
export async function ollamaChat(
  url: string,
  model: string,
  prompt: string,
  options: { images?: string[]; system?: string; numCtx?: number; signal?: AbortSignal } = {},
): Promise<string> {
  const messages = [
    ...(options.system ? [{ role: 'system', content: options.system }] : []),
    { role: 'user', content: prompt, ...(options.images?.length && { images: options.images }) },
  ];
  const res = await fetch(`${base(url)}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: false, think: false, options: { num_ctx: options.numCtx ?? 8192, temperature: 0.2 } }),
    signal: AbortSignal.any([AbortSignal.timeout(CALL_TIMEOUT_MS), ...(options.signal ? [options.signal] : [])]),
  });
  if (!res.ok) throw await failure(res, 'The Lab model server');
  const data = (await res.json()) as { message?: { content?: string } };
  // Some reasoning models still wrap their thoughts in the answer.
  return (data.message?.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

/**
 * Speech to text on an OpenAI-compatible server (whisper.cpp started with
 * `--inference-path /v1/audio/transcriptions`, speaches, LocalAI...). Returns timed segments
 * when the server gives them, else one segment with the whole text.
 */
export async function transcribe(
  url: string,
  model: string,
  audio: Buffer,
  fileName: string,
  options: { language?: string; signal?: AbortSignal } = {},
): Promise<{ text: string; segments: Segment[]; language: string | null }> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(audio)]), fileName);
  form.append('model', model || 'whisper-1');
  form.append('response_format', 'verbose_json');
  if (options.language) form.append('language', options.language);
  const res = await fetch(`${base(url)}/v1/audio/transcriptions`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.any([AbortSignal.timeout(CALL_TIMEOUT_MS), ...(options.signal ? [options.signal] : [])]),
  });
  if (!res.ok) throw await failure(res, 'The transcription server');
  const data = (await res.json()) as {
    text?: string;
    language?: string;
    segments?: { start?: number; end?: number; t0?: number; t1?: number; text?: string }[];
  };
  const segments = (data.segments ?? [])
    .map((s) => ({
      // whisper.cpp's own format counts in centiseconds (t0/t1); the OpenAI one in seconds.
      start: s.start ?? (s.t0 ?? 0) / 100,
      end: s.end ?? (s.t1 ?? 0) / 100,
      text: (s.text ?? '').trim(),
    }))
    .filter((s) => s.text);
  const text = (data.text ?? segments.map((s) => s.text).join(' ')).trim();
  return { text, segments: segments.length ? segments : text ? [{ start: 0, end: 0, text }] : [], language: data.language ?? null };
}
