import type { FileEntry, WorkspacePort } from '../ports.js';
import { defineTool, type Tool, type ToolContext } from './tool.js';

/** RAG collections live here and are managed only by the rag tools. */
export const RAG_DIR = '.rag';
/** Below the loop's 20k cap on a tool result, so the metadata and next_offset always survive. */
const MAX_READ_CHARS = 15_000;
const MAX_WRITE_BYTES = 1_000_000;
const MAX_LIST = 500;
const MAX_SEARCH_FILES = 2000;
const MAX_SEARCH_HITS = 50;

export function workspaceOf(ctx: ToolContext): WorkspacePort {
  if (!ctx.workspace) throw new Error('No file workspace is available here');
  return ctx.workspace;
}

/** Normalizes a model-supplied path: forward slashes, no leading "./" or "/", no "..". */
export function cleanPath(raw: unknown): string {
  const path = String(raw ?? '')
    .replace(/\\/g, '/')
    .replace(/^\.?\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\/{2,}/g, '/');
  if (path.split('/').some((part) => part === '..')) throw new Error('Paths cannot contain ".."');
  return path;
}

function assertNotRag(path: string): void {
  if (path === RAG_DIR || path.startsWith(`${RAG_DIR}/`)) {
    throw new Error('The .rag folder is managed by the rag_ tools; use them instead');
  }
}

/** Text when the bytes look like UTF-8 text, else null. */
export function asText(data: Buffer): string | null {
  const sample = data.subarray(0, 8000);
  if (sample.includes(0)) return null;
  const text = data.toString('utf8');
  // Many replacement characters: binary, not text.
  const bad = (text.slice(0, 8000).match(/�/g) ?? []).length;
  return bad > 20 ? null : text;
}

/** Readable text of any file: plain text directly, documents through the host's extractor. */
export async function readableText(ctx: ToolContext, path: string): Promise<{ pages: string[] } | null> {
  const data = await workspaceOf(ctx).read(ctx.user.id, path);
  // The extractor knows document formats (and their pages) better than a text guess; plain text is the fallback.
  const extracted = ctx.extractor ? await ctx.extractor.extract(data, path.split('/').pop() ?? path) : null;
  if (extracted) return extracted;
  const text = asText(data);
  return text !== null ? { pages: [text] } : null;
}

/** Every file under `path` (depth first), up to `max`. */
export async function walk(ws: WorkspacePort, userId: string, path: string, max: number): Promise<FileEntry[]> {
  const out: FileEntry[] = [];
  const stack = [path];
  while (stack.length && out.length < max) {
    const dir = stack.pop()!;
    for (const entry of await ws.list(userId, dir)) {
      if (entry.type === 'dir') {
        if (entry.path !== RAG_DIR) stack.push(entry.path);
      } else if (out.length < max) out.push(entry);
    }
  }
  return out;
}

export const filesList = defineTool<{ path?: string; recursive?: boolean }>({
  name: 'files_list',
  description: "List a folder of the user's workspace (\"\" is the root). Set recursive to see everything below it.",
  parameters: {
    type: 'object',
    properties: { path: { type: 'string' }, recursive: { type: 'boolean' } },
  },
  sideEffect: 'none',
  parallelSafe: true,
  async run(args, ctx) {
    const ws = workspaceOf(ctx);
    const path = cleanPath(args.path);
    const entries = args.recursive ? await walk(ws, ctx.user.id, path, MAX_LIST) : await ws.list(ctx.user.id, path);
    return entries
      .filter((e) => e.path !== RAG_DIR)
      .slice(0, MAX_LIST)
      .map((e) => ({ path: e.path, type: e.type, size: e.size, modified: e.modifiedAt }));
  },
});

export const filesRead = defineTool<{ path: string; offset?: number; page?: number }>({
  name: 'files_read',
  description:
    'Read a file as text. Documents (PDF, Word...) are converted to text with page numbers. Long files come in parts: ' +
    'pass `offset` from the previous answer to continue, or `page` to read one page of a document.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      offset: { type: 'integer', description: 'Character offset to start at (default 0)' },
      page: { type: 'integer', description: 'Only this page of a document (1-based)' },
    },
    required: ['path'],
  },
  sideEffect: 'none',
  untrusted: true,
  parallelSafe: true,
  async run(args, ctx) {
    const path = cleanPath(args.path);
    const doc = await readableText(ctx, path);
    if (!doc) throw new Error('This file is binary and cannot be read as text');
    let text: string;
    if (args.page !== undefined) {
      const page = doc.pages[Number(args.page) - 1];
      if (page === undefined) throw new Error(`The document has ${doc.pages.length} pages`);
      text = page;
    } else {
      text = doc.pages.length > 1 ? doc.pages.map((p, i) => `--- page ${i + 1} ---\n${p}`).join('\n') : doc.pages[0]!;
    }
    const offset = Math.max(0, Number(args.offset) || 0);
    const slice = text.slice(offset, offset + MAX_READ_CHARS);
    const next = offset + slice.length;
    return {
      path,
      pages: doc.pages.length,
      total_chars: text.length,
      ...(next < text.length && { next_offset: next }),
      content: slice,
    };
  },
});

export const filesWrite = defineTool<{ path: string; content: string; append?: boolean }>({
  name: 'files_write',
  description:
    'Create or replace a text file in the workspace (folders are created as needed), or append to it. Good for notes, ' +
    'summaries, plans and study material. Max 1 MB per call.',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string' }, content: { type: 'string' }, append: { type: 'boolean' } },
    required: ['path', 'content'],
  },
  sideEffect: 'none',
  mainAgentOnly: true,
  async run(args, ctx) {
    const path = cleanPath(args.path);
    if (!path) throw new Error('path is required');
    assertNotRag(path);
    const content = String(args.content ?? '');
    if (Buffer.byteLength(content) > MAX_WRITE_BYTES) throw new Error('content is larger than 1 MB; write it in parts with append');
    await workspaceOf(ctx).write(ctx.user.id, path, content, { append: args.append === true });
    return { written: true, path, bytes: Buffer.byteLength(content), appended: args.append === true };
  },
});

export const filesMkdir = defineTool<{ path: string }>({
  name: 'files_mkdir',
  description: 'Create a folder (and its parents), e.g. "Fall 2026/ACG 2021".',
  parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  sideEffect: 'none',
  mainAgentOnly: true,
  async run(args, ctx) {
    const path = cleanPath(args.path);
    if (!path) throw new Error('path is required');
    assertNotRag(path);
    await workspaceOf(ctx).mkdir(ctx.user.id, path);
    return { created: true, path };
  },
});

export const filesMove = defineTool<{ from: string; to: string }>({
  name: 'files_move',
  description: 'Move or rename a file or folder. Also how to keep something from a temporary area.',
  parameters: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] },
  sideEffect: 'none',
  mainAgentOnly: true,
  async run(args, ctx) {
    const from = cleanPath(args.from);
    const to = cleanPath(args.to);
    if (!from || !to) throw new Error('from and to are required');
    assertNotRag(from);
    assertNotRag(to);
    await workspaceOf(ctx).move(ctx.user.id, from, to);
    return { moved: true, from, to };
  },
});

export const filesDelete = defineTool<{ path: string }>({
  name: 'files_delete',
  description: 'Delete a file or a folder with everything in it. Use it to free space, e.g. sources after building a RAG.',
  parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  sideEffect: 'none',
  mainAgentOnly: true,
  async run(args, ctx) {
    const path = cleanPath(args.path);
    if (!path) throw new Error('Refusing to delete the whole workspace');
    assertNotRag(path);
    await workspaceOf(ctx).delete(ctx.user.id, path);
    return { deleted: true, path };
  },
});

export const filesSearch = defineTool<{ query: string; path?: string; in_content?: boolean }>({
  name: 'files_search',
  description: 'Find files by name, or (in_content: true) text files containing the words. Returns matching lines.',
  parameters: {
    type: 'object',
    properties: { query: { type: 'string' }, path: { type: 'string' }, in_content: { type: 'boolean' } },
    required: ['query'],
  },
  sideEffect: 'none',
  parallelSafe: true,
  async run(args, ctx) {
    const ws = workspaceOf(ctx);
    const query = String(args.query ?? '').trim().toLowerCase();
    if (!query) throw new Error('query is empty');
    const files = await walk(ws, ctx.user.id, cleanPath(args.path), MAX_SEARCH_FILES);
    const hits: { path: string; line?: number; text?: string }[] = [];
    for (const file of files) {
      if (hits.length >= MAX_SEARCH_HITS) break;
      if (file.path.toLowerCase().includes(query)) hits.push({ path: file.path });
      if (!args.in_content || file.size > MAX_WRITE_BYTES) continue;
      const text = asText(await ws.read(ctx.user.id, file.path));
      if (text === null) continue;
      text.split('\n').forEach((line, i) => {
        if (hits.length < MAX_SEARCH_HITS && line.toLowerCase().includes(query)) {
          hits.push({ path: file.path, line: i + 1, text: line.trim().slice(0, 200) });
        }
      });
    }
    return { hits, truncated: hits.length >= MAX_SEARCH_HITS };
  },
});

export const filesUsage = defineTool({
  name: 'files_usage',
  description: 'Space used and left in each storage area, with its rules.',
  parameters: { type: 'object', properties: {} },
  sideEffect: 'none',
  parallelSafe: true,
  async run(_args, ctx) {
    const areas = await workspaceOf(ctx).usage(ctx.user.id);
    const mb = (bytes: number) => Math.round((bytes / 1048576) * 10) / 10;
    return areas.map((a) => ({ area: a.name, used_mb: mb(a.usedBytes), limit_mb: mb(a.limitBytes), free_mb: mb(a.limitBytes - a.usedBytes), note: a.note }));
  },
});

export const FILES_TOOLS: Tool[] = [filesList, filesRead, filesWrite, filesMkdir, filesMove, filesDelete, filesSearch, filesUsage];
