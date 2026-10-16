import { errorFrom, ProviderError } from './providers/http.js';

/** Sizes every image backend here accepts; `auto` lets the model pick from the prompt. */
export const IMAGE_SIZES = ['auto', '1024x1024', '1536x1024', '1024x1536'] as const;
export type ImageSize = (typeof IMAGE_SIZES)[number];

export interface ImageRequest {
  prompt: string;
  size: ImageSize;
  /** Pictures to start from or edit (e.g. a photo the student attached). */
  references?: { mediaType: string; data: Buffer; name: string }[];
  signal?: AbortSignal;
}

export interface GeneratedImage {
  data: Buffer;
  mediaType: 'image/png';
  /** The prompt the backend actually drew from, when it rewrote it. */
  revisedPrompt?: string;
}

/** Something that turns a prompt into a picture with one of the student's own connections. */
export interface ImageGenerator {
  /** Shown to the model and in the tool result, e.g. "ChatGPT" or "OpenAI". */
  label: string;
  generate(request: ImageRequest): Promise<GeneratedImage>;
}

const OPENAI_IMAGE_MODEL = 'gpt-image-1';

/** An OpenAI API key: the Images API (generations, or edits when there are pictures to start from). Billed to that key. */
export class OpenAIImages implements ImageGenerator {
  readonly label = 'OpenAI';

  constructor(
    private baseUrl: string,
    private apiKey: string,
  ) {}

  async generate(request: ImageRequest): Promise<GeneratedImage> {
    const headers = { authorization: `Bearer ${this.apiKey}` };
    let res: Response;
    if (request.references?.length) {
      const form = new FormData();
      form.set('model', OPENAI_IMAGE_MODEL);
      form.set('prompt', request.prompt);
      form.set('size', request.size);
      for (const ref of request.references) form.append('image[]', new Blob([new Uint8Array(ref.data)], { type: ref.mediaType }), ref.name);
      res = await fetch(`${this.baseUrl}/images/edits`, { method: 'POST', headers, body: form, signal: request.signal });
    } else {
      res = await fetch(`${this.baseUrl}/images/generations`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ model: OPENAI_IMAGE_MODEL, prompt: request.prompt, size: request.size, n: 1 }),
        signal: request.signal,
      });
    }
    if (!res.ok) throw await errorFrom(res, 'OpenAI');
    const json = (await res.json()) as { data?: { b64_json?: string; revised_prompt?: string }[] };
    const first = json.data?.[0];
    if (!first?.b64_json) throw new ProviderError('OpenAI: no image came back', 502);
    return { data: Buffer.from(first.b64_json, 'base64'), mediaType: 'image/png', ...(first.revised_prompt && { revisedPrompt: first.revised_prompt }) };
  }
}
