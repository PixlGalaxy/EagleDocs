import { defineTool, type ToolContext } from 'pixlai-engine';
import type { ImageNotes } from '../../modules/files/image-notes.js';
import type { Seen } from '../../modules/models/vision.js';
import type { DiskWorkspace } from '../workspace.js';

/** What the worker puts in `host.vision` for each run. */
export interface VisionHost {
  userId: string;
  workspace: DiskWorkspace;
  notes: ImageNotes;
  /** Has a vision model look at the picture; null when the student has none that can. */
  see(image: { mediaType: string; data: string; name: string }, question: string | undefined, signal: AbortSignal): Promise<(Seen & { by: string }) | null>;
}

export const IMAGE_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
/** Over this, providers refuse the picture (Anthropic's cap is about 5 MB of base64). */
const MAX_BYTES = 3.5 * 1024 * 1024;

function visionOf(ctx: ToolContext): VisionHost {
  const host = ctx.host.vision as VisionHost | undefined;
  if (!host) throw new Error('Looking at pictures is not available in this run');
  return host;
}

export const imageView = defineTool<{ path: string; question?: string; refresh?: boolean }>({
  name: 'image_view',
  description:
    "Tells you what a picture in the workspace shows (you cannot see workspace images yourself): a detailed description with " +
    'any text in it copied exactly, plus an answer to your question. Use it before saying anything about an image the ' +
    'student made, attached earlier, downloaded from Canvas or that you generated; never guess from a file name. The ' +
    'description is remembered, so asking again about the same file is free unless you pass a question or refresh.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace path of a PNG, JPEG, WebP or GIF' },
      question: { type: 'string', description: 'What you need to know about it (e.g. "what does the hawk wear on its face?")' },
      refresh: { type: 'boolean', description: 'Look again even if a description is saved' },
    },
    required: ['path'],
  },
  sideEffect: 'none',
  untrusted: true,
  timeoutMs: 3 * 60_000,
  async run(args, ctx) {
    const host = visionOf(ctx);
    const path = String(args.path ?? '').trim().replace(/^\/+/, '');
    const mediaType = IMAGE_TYPES[path.split('.').pop()?.toLowerCase() ?? ''];
    if (!mediaType) throw new Error(`${path} is not a PNG, JPEG, WebP or GIF picture`);
    const file = await host.workspace.stat(host.userId, path);
    if (!file || file.type !== 'file') {
      await host.notes.forget(host.userId, path);
      throw new Error(`${path} does not exist`);
    }

    const question = args.question?.trim() || undefined;
    const saved = await host.notes.get(host.userId, path, file);
    if (saved && !question && !args.refresh) return { path, description: saved.description, from: saved.source === 'generated' ? 'the prompt it was generated from' : 'an earlier look' };

    if (file.size > MAX_BYTES) {
      return { path, error: `It is too large to look at (${Math.round(file.size / 1048576)} MB, the limit is 3.5 MB).`, ...(saved && { saved_description: saved.description }) };
    }
    const data = (await host.workspace.read(host.userId, path)).toString('base64');
    const seen = await host.see({ mediaType, data, name: path }, question, ctx.signal);
    if (!seen) {
      return {
        path,
        error: 'No model that can see pictures is connected (this chat model has no vision, and there is no ChatGPT account or vision model to fall back on). Tell the student you cannot see it; do not guess what it shows.',
        ...(saved && { saved_description: saved.description }),
      };
    }
    await host.notes.save(host.userId, path, file, seen.description, 'viewed');
    return { path, description: seen.description, ...(seen.answer && { answer: seen.answer }), seen_by: seen.by };
  },
});

export const imagesSearch = defineTool<{ query: string; limit?: number }>({
  name: 'images_search',
  description:
    "Finds pictures in the student's workspace by what they show (\"the hawk with glasses\", \"slide with the supply curve\"), " +
    'among the ones you generated or have looked at before with image_view. Returns paths with their descriptions.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'What the picture shows, in any language' },
      limit: { type: 'integer', description: 'Results, 1-20 (default 8)' },
    },
    required: ['query'],
  },
  sideEffect: 'none',
  untrusted: true,
  parallelSafe: true,
  async run(args, ctx) {
    const host = visionOf(ctx);
    const limit = Math.min(Math.max(args.limit ?? 8, 1), 20);
    const notes = await host.notes.search(host.userId, String(args.query ?? ''), limit);
    const found = [];
    for (const note of notes) {
      // A file deleted or moved since: drop its note.
      if (!(await host.workspace.stat(host.userId, note.path))) {
        await host.notes.forget(host.userId, note.path);
        continue;
      }
      found.push({ path: note.path, description: note.description.length > 600 ? `${note.description.slice(0, 600)}...` : note.description, source: note.source });
    }
    return found.length
      ? { images: found }
      : 'No described picture matches. Pictures are described when generated or looked at with image_view; files_search or files_list can find others by name.';
  },
});

export const VISION_TOOLS = [imageView, imagesSearch];
