import { defineTool, type ToolContext } from 'pixlai-engine';
import { IMAGE_SIZES, type ImageGenerator, type ImageSize } from '../../modules/models/images.js';
import type { DiskWorkspace } from '../workspace.js';
import type { ImageNotes } from '../../modules/files/image-notes.js';

/** What the worker puts in `host.images` when the student has something that makes pictures. */
export interface ImagesHost {
  generator: ImageGenerator;
  userId: string;
  workspace: DiskWorkspace;
  /** Where pictures go unless the model names a path (the chat's folder). */
  folder: string;
  /** Where the picture's prompt is kept as its description (image_view and images_search read it). */
  notes?: ImageNotes;
}

/** A picture can take a minute or two on a busy account. */
const IMAGE_TIMEOUT_MS = 4 * 60_000;
const MAX_REFERENCES = 4;
const MAX_REFERENCE_BYTES = 20 * 1024 * 1024;
const REFERENCE_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

function imagesOf(ctx: ToolContext): ImagesHost {
  const host = ctx.host.images as ImagesHost | undefined;
  if (!host) throw new Error('Image generation is not available: the student has no ChatGPT account or OpenAI key connected.');
  return host;
}

/** A file name from the prompt's first words, e.g. "cyan-hawk-reading.png". */
function nameFrom(prompt: string): string {
  const slug = prompt
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .split('-')
    .filter(Boolean)
    .slice(0, 6)
    .join('-');
  return `${slug || 'image'}.png`;
}

/** `path` itself, or the same name with -2, -3... when it is taken. */
async function freePath(host: ImagesHost, path: string): Promise<string> {
  const dot = path.lastIndexOf('.');
  for (let n = 1; n < 100; n++) {
    const candidate = n === 1 ? path : `${path.slice(0, dot)}-${n}${path.slice(dot)}`;
    if (!(await host.workspace.stat(host.userId, candidate))) return candidate;
  }
  throw new Error(`Too many files named like ${path}`);
}

export const imageGenerate = defineTool<{ prompt: string; size?: ImageSize; path?: string; reference_images?: string[] }>({
  name: 'image_generate',
  description:
    "Makes a real picture (PNG) with the student's own ChatGPT account or OpenAI key and saves it in the workspace. Use it whenever " +
    'the student asks for an image, picture, drawing, illustration, poster, logo, icon, photo or diagram-like art, instead of ' +
    'drawing SVG or HTML yourself (use SVG only when they ask for SVG or an exact chart). Write a detailed prompt: subject, ' +
    'style, colors, composition and any text that must appear (spelled exactly). To edit or build on pictures (an attached ' +
    'photo, an earlier result), pass their workspace paths in reference_images. Show the result in your answer as ' +
    '![short description](workspace:<path>).',
  parameters: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'What to draw, in detail. Any language.' },
      size: { type: 'string', enum: [...IMAGE_SIZES], description: 'Square 1024x1024, landscape 1536x1024, portrait 1024x1536, or auto (default)' },
      path: { type: 'string', description: "Workspace path ending in .png. Default: the chat's folder, named from the prompt" },
      reference_images: { type: 'array', items: { type: 'string' }, description: `Workspace paths of pictures to edit or start from (up to ${MAX_REFERENCES})` },
    },
    required: ['prompt'],
  },
  sideEffect: 'none',
  timeoutMs: IMAGE_TIMEOUT_MS,
  view: (args) => ({ prompt: args.prompt.length > 300 ? `${args.prompt.slice(0, 300)}...` : args.prompt, ...(args.path && { path: args.path }) }),
  async run(args, ctx) {
    const host = imagesOf(ctx);
    const prompt = String(args.prompt ?? '').trim();
    if (!prompt) throw new Error('prompt is empty');
    const size = IMAGE_SIZES.includes(args.size as ImageSize) ? (args.size as ImageSize) : 'auto';

    const references = [];
    for (const ref of (args.reference_images ?? []).slice(0, MAX_REFERENCES)) {
      const ext = ref.split('.').pop()?.toLowerCase() ?? '';
      const mediaType = REFERENCE_TYPES[ext];
      if (!mediaType) throw new Error(`${ref} is not a PNG, JPEG, WebP or GIF picture`);
      const data = await host.workspace.read(host.userId, ref);
      if (data.length > MAX_REFERENCE_BYTES) throw new Error(`${ref} is too big to send (over 20 MB)`);
      references.push({ mediaType, data, name: ref.split('/').pop() ?? 'image' });
    }

    const wanted = args.path?.trim().replace(/^\/+/, '') || `${host.folder}/${nameFrom(prompt)}`;
    const target = await freePath(host, /\.png$/i.test(wanted) ? wanted : `${wanted.replace(/\.[a-z0-9]{1,5}$/i, '')}.png`);

    const image = await host.generator.generate({ prompt, size, references, signal: ctx.signal });
    await host.workspace.write(host.userId, target, image.data);
    // Described from birth: what it was drawn from, so it can be found and talked about without looking at it.
    const file = await host.workspace.stat(host.userId, target);
    if (host.notes && file) {
      const from = image.revisedPrompt && image.revisedPrompt !== prompt ? `${prompt}\n\nAs drawn: ${image.revisedPrompt}` : prompt;
      await host.notes.save(host.userId, target, file, `Generated by Hawk with ${host.generator.label} from this prompt:\n${from}`, 'generated').catch(() => undefined);
    }
    return {
      path: target,
      show_with: `![${prompt.slice(0, 60).replace(/[[\]]/g, '')}](workspace:${encodeURI(target)})`,
      made_with: host.generator.label,
      bytes: image.data.length,
      ...(image.revisedPrompt && { revised_prompt: image.revisedPrompt }),
    };
  },
});

export const IMAGE_TOOLS = [imageGenerate];
