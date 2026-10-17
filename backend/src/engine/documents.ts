import type { EmbeddingPort, TextExtractor } from 'pixlai-engine';
import type { LabService } from '../modules/lab/lab.service.js';
import { currentUser } from './run-user.js';
import type { Db } from '../db/pool.js';
import { maybe } from '../db/pool.js';
import type { Secrets } from '../crypto/secrets.js';
import { stripHtml } from '../modules/canvas/priority.js';
import { errorFrom } from '../modules/models/providers/http.js';

/** PDF (per page), Word, PowerPoint (per slide) and HTML to text. Plain text files are handled by the engine itself. */
export const documentExtractor: TextExtractor = {
  async extract(data, filename) {
    const ext = filename.toLowerCase().split('.').pop() ?? '';
    if (ext === 'pdf' || data.subarray(0, 5).toString('latin1') === '%PDF-') {
      const { extractText, getDocumentProxy } = await import('unpdf');
      const pdf = await getDocumentProxy(new Uint8Array(data));
      const { text } = await extractText(pdf, { mergePages: false });
      return { pages: (text as string[]).map((page) => page.replace(/[ \t]+\n/g, '\n').trim()) };
    }
    if (ext === 'docx') return { pages: await docxPages(data) };
    if (ext === 'pptx') return { pages: await pptxSlides(data) };
    if (ext === 'html' || ext === 'htm') return { pages: [stripHtml(data.toString('utf8'))] };
    return null;
  },
};

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** The text runs of a DrawingML part, one line per paragraph. */
function drawingText(xml: string): string {
  return xml
    .split(/<\/a:p>/)
    .map((p) => [...p.matchAll(/<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>/g)].map((m) => m[1]).join(''))
    .filter((line) => line.trim())
    .join('\n')
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, e: string) => XML_ENTITIES[e]!)
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)));
}

const decodeXml = (text: string) =>
  text
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, e: string) => XML_ENTITIES[e]!)
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)));

/**
 * Word: the body's paragraphs in order (tables cell by cell, a row per line),
 * split into pages at explicit page breaks so citations can point at a page.
 */
async function docxPages(data: Buffer): Promise<string[]> {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(data);
  const xml = await zip.file('word/document.xml')?.async('string');
  if (!xml) return [];
  const body = xml.replace(/<w:tc\b[^>]*>/g, '').replace(/<\/w:tc>/g, '\t').replace(/<\/w:tr>/g, '</w:p>');
  const pages: string[] = [];
  let lines: string[] = [];
  for (const para of body.split(/<\/w:p>/)) {
    // Paragraph text: runs, tabs and line breaks, in order.
    const parts = [...para.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:(tab|br|cr)\b([^>]*)\/>|\t/g)];
    let line = '';
    let pageBreak = false;
    for (const m of parts) {
      if (m[1] !== undefined) line += m[1];
      else if (m[2] === 'tab' || m[0] === '\t') line += '\t';
      else if (/w:type="page"/.test(m[3] ?? '')) pageBreak = true;
      else line += '\n';
    }
    // Indentation tabs are layout; tabs between words separate columns or table cells.
    const text = decodeXml(line).replace(/^\t+|\t+$/g, '').replace(/\t+/g, ' | ');
    if (text.trim()) lines.push(text);
    if (pageBreak && lines.length) {
      pages.push(lines.join('\n'));
      lines = [];
    }
  }
  if (lines.length) pages.push(lines.join('\n'));
  return pages;
}

/** PowerPoint: one page per slide (in order), with the speaker notes after the slide text. */
async function pptxSlides(data: Buffer): Promise<string[]> {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(data);
  const number = (name: string) => Number(/(\d+)\.xml$/.exec(name)?.[1] ?? 0);
  const slides = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => number(a) - number(b));
  const pages: string[] = [];
  for (const name of slides) {
    const text = drawingText(await zip.file(name)!.async('string'));
    const notesFile = zip.file(`ppt/notesSlides/notesSlide${number(name)}.xml`);
    const notes = notesFile ? drawingText(await notesFile.async('string')).replace(/^\d+$/m, '').trim() : '';
    pages.push(notes ? `${text}\n\nNotes: ${notes}` : text);
  }
  return pages;
}

interface EmbeddingModelRow {
  model_name: string;
  kind: 'ollama' | 'openai_compat';
  base_url: string;
  api_key_enc: Buffer | null;
}

/**
 * Embeddings for RAG. With an embedding model in Admin -> Accelerator Lab they go through the Lab's
 * queue, as tasks of the student whose run asks (one query goes ahead of batch work and still runs
 * when their units are used up); otherwise through the model an admin tagged "embedding" in
 * Admin -> Models. Looked up on each use, so a change needs no restart; RAGs built with another
 * model ask to be rebuilt.
 */
export class AdminEmbeddings implements EmbeddingPort {
  private current: { row: EmbeddingModelRow; at: number } | null = null;
  private lab: LabService | null = null;

  constructor(private db: Db, private secrets: Secrets) {}

  /** The Accelerator Lab, when this server has one (set once at startup). */
  useLab(lab: LabService): void {
    this.lab = lab;
  }

  private async row(): Promise<EmbeddingModelRow> {
    if (this.current && Date.now() - this.current.at < 30_000) return this.current.row;
    const row = await maybe<EmbeddingModelRow>(
      this.db,
      `SELECT m.model_name, e.kind, e.base_url, e.api_key_enc FROM models m JOIN model_endpoints e ON e.id = m.endpoint_id
       WHERE m.enabled AND e.enabled AND m.tags ? 'embedding' ORDER BY m.model_name LIMIT 1`,
    );
    if (!row) throw new Error('RAG is not available yet: an administrator has to enable an embedding model (Admin > Models, tag "embedding").');
    this.current = { row, at: Date.now() };
    return row;
  }

  /** The engine compares this with each RAG's manifest; refreshed by `refresh()` before a run. */
  model = 'not-configured';

  async refresh(): Promise<void> {
    const labModel = this.lab?.embedModel();
    if (labModel) {
      this.model = labModel;
      return;
    }
    try {
      this.model = (await this.row()).model_name;
    } catch {
      this.model = 'not-configured';
    }
  }

  async embed(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    const labModel = this.lab?.embedModel();
    if (this.lab && labModel) {
      this.model = labModel;
      const userId = currentUser();
      if (!userId) return this.lab.embedNow(texts, signal);
      const query = texts.length === 1;
      const { vectors } = await this.lab.run(userId, 'embed', { texts }, { priority: query ? 0 : 1, exempt: query, signal });
      return vectors;
    }
    const row = await this.row();
    this.model = row.model_name;
    const base = row.base_url.replace(/\/+$/, '');
    if (row.kind === 'ollama') {
      const res = await fetch(`${base}/api/embed`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: row.model_name, input: texts, truncate: true }),
        signal,
      });
      if (!res.ok) throw await errorFrom(res, 'Embeddings');
      return ((await res.json()) as { embeddings: number[][] }).embeddings;
    }
    const key = row.api_key_enc ? this.secrets.decrypt(row.api_key_enc) : undefined;
    const res = await fetch(`${base}/embeddings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(key && { authorization: `Bearer ${key}` }) },
      body: JSON.stringify({ model: row.model_name, input: texts }),
      signal,
    });
    if (!res.ok) throw await errorFrom(res, 'Embeddings');
    return ((await res.json()) as { data: { embedding: number[] }[] }).data.map((d) => d.embedding);
  }
}
