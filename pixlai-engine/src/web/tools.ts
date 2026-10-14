import type { FetchPort, FetchedPage, SearchPort } from '../ports.js';
import { asText, cleanPath, RAG_DIR, workspaceOf } from '../tools/files.js';
import { defineTool, type Tool, type ToolContext } from '../tools/tool.js';
import { htmlToText } from './html.js';

const MAX_RESULTS = 10;
const PAGE_CHARS = 15_000;
const MAX_FETCH_BYTES = 10 * 1024 * 1024;
const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;

function searchOf(ctx: ToolContext): SearchPort {
  if (!ctx.search) throw new Error('Web search is not available here');
  return ctx.search;
}

function fetcherOf(ctx: ToolContext): FetchPort {
  if (!ctx.fetcher) throw new Error('Downloading web pages is not available here');
  return ctx.fetcher;
}

function httpUrl(raw: unknown): string {
  let url: URL;
  try {
    url = new URL(String(raw ?? '').trim());
  } catch {
    throw new Error('Give a full URL starting with http:// or https://');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only http and https URLs are supported');
  return url.toString();
}

/** File name for a URL, from its path or its content type. */
function nameFor(page: Pick<FetchedPage, 'url' | 'contentType'>): string {
  const last = decodeURIComponent(new URL(page.url).pathname.split('/').pop() ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_');
  if (/\.[a-z0-9]{2,5}$/i.test(last)) return last.slice(0, 150);
  const ext = /pdf/.test(page.contentType) ? 'pdf' : /html/.test(page.contentType) ? 'html' : /json/.test(page.contentType) ? 'json' : 'txt';
  return `${(last || new URL(page.url).hostname).slice(0, 140)}.${ext}`;
}

/** Any page or document as text pages: HTML cleaned up, documents through the extractor, text as is. */
async function pageText(ctx: ToolContext, page: FetchedPage): Promise<{ title: string; pages: string[] } | null> {
  const type = page.contentType.toLowerCase();
  if (type.includes('html') || (!type && /^\s*<(!doctype|html)/i.test(page.body.subarray(0, 200).toString('utf8')))) {
    const { title, text } = htmlToText(page.body.toString('utf8'), page.url);
    return { title, pages: [text] };
  }
  const extracted = ctx.extractor ? await ctx.extractor.extract(page.body, nameFor(page)) : null;
  if (extracted) return { title: '', pages: extracted.pages };
  const text = asText(page.body);
  return text === null ? null : { title: '', pages: [text] };
}

export const webSearch = defineTool<{ query: string; limit?: number }>({
  name: 'web_search',
  description:
    'Search the web. Returns titles, URLs and snippets; open the promising ones with web_fetch. Write queries like a ' +
    'person would type them; search in English for broader results unless the topic is local.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      limit: { type: 'integer', description: `Results, 1-${MAX_RESULTS} (default 6)` },
    },
    required: ['query'],
  },
  sideEffect: 'none',
  untrusted: true,
  parallelSafe: true,
  async run(args, ctx) {
    const query = String(args.query ?? '').trim().slice(0, 400);
    if (!query) throw new Error('query is empty');
    const limit = Math.min(MAX_RESULTS, Math.max(1, Number(args.limit) || 6));
    const hits = await searchOf(ctx).search(query, { limit, language: ctx.user.language, signal: ctx.signal });
    if (hits.length === 0) return { query, results: [], note: 'No results. Try other words, or fewer of them.' };
    return {
      query,
      results: hits.slice(0, limit).map((h, i) => ({ n: i + 1, title: h.title.slice(0, 200), url: h.url, snippet: h.snippet.replace(/\s+/g, ' ').slice(0, 400) })),
    };
  },
});

export const webFetch = defineTool<{ url: string; offset?: number; page?: number }>({
  name: 'web_fetch',
  description:
    'Open a web page or online document (PDF, DOCX...) and read it as text, without a browser: articles, docs, syllabi, ' +
    `search results. Long content comes in parts of ${PAGE_CHARS} characters: pass next_offset to continue. For pages that ` +
    'need a login or JavaScript, use the browser tools instead. To keep a file, use web_download.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string' },
      offset: { type: 'integer', description: 'Character offset to continue from (default 0)' },
      page: { type: 'integer', description: 'Only this page of a document (1-based)' },
    },
    required: ['url'],
  },
  sideEffect: 'none',
  untrusted: true,
  parallelSafe: true,
  timeoutMs: 90_000,
  async run(args, ctx) {
    const page = await fetcherOf(ctx).fetch(httpUrl(args.url), { maxBytes: MAX_FETCH_BYTES, signal: ctx.signal });
    if (page.status >= 400) return { url: page.url, status: page.status, error: `The site answered ${page.status}` };
    const doc = await pageText(ctx, page);
    if (!doc) return { url: page.url, content_type: page.contentType, error: 'This is not a page or document that can be read as text' };
    const pageNo = Number(args.page) || 0;
    if (pageNo && (pageNo < 1 || pageNo > doc.pages.length)) throw new Error(`page must be between 1 and ${doc.pages.length}`);
    const text = pageNo ? doc.pages[pageNo - 1]! : doc.pages.join('\n\n');
    const offset = Math.max(0, Number(args.offset) || 0);
    const part = text.slice(offset, offset + PAGE_CHARS);
    const next = offset + PAGE_CHARS < text.length ? offset + PAGE_CHARS : null;
    return {
      url: page.url,
      ...(doc.title && { title: doc.title }),
      ...(doc.pages.length > 1 && { pages: doc.pages.length }),
      total_chars: text.length,
      ...(next !== null && { next_offset: next }),
      content: part || '(no text found on this page; it may need JavaScript: try the browser tools)',
    };
  },
});

export const webDownload = defineTool<{ url: string; folder?: string }>({
  name: 'web_download',
  description:
    "Save a file from the web (PDF, slides, a dataset...) into the user's files, by default TEMP/web/ (deleted after 24 h " +
    'when the workspace has that rule). Then read it with files_read, index it with rag_add or process it with code_run.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string' },
      folder: { type: 'string', description: 'Destination folder in the workspace, default "TEMP/web"' },
    },
    required: ['url'],
  },
  sideEffect: 'none',
  mainAgentOnly: true,
  timeoutMs: 10 * 60_000,
  async run(args, ctx) {
    const ws = workspaceOf(ctx);
    const folder = cleanPath(args.folder ?? 'TEMP/web');
    if (folder === RAG_DIR || folder.startsWith(`${RAG_DIR}/`)) throw new Error(`${RAG_DIR} is managed by the rag_ tools`);
    const page = await fetcherOf(ctx).fetch(httpUrl(args.url), { maxBytes: MAX_DOWNLOAD_BYTES, signal: ctx.signal });
    if (page.status >= 400) return { url: page.url, status: page.status, error: `The site answered ${page.status}` };
    const path = folder ? `${folder}/${nameFor(page)}` : nameFor(page);
    await ws.write(ctx.user.id, path, page.body);
    return { saved: path, size_mb: Math.round((page.body.length / 1048576) * 100) / 100, content_type: page.contentType };
  },
});

export const WEB_TOOLS: Tool[] = [webSearch, webFetch, webDownload];
