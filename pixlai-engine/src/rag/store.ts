import type { SharedRagSource, WorkspacePort } from '../ports.js';

/**
 * RAG collections as three plain files, so they live in any WorkspacePort,
 * count toward the user's quota and need no vector database:
 *   manifest.json  name, description, embedding model, sources
 *   chunks.jsonl   one {source, page, text} per line
 *   vectors.f32    unit-length float32 vectors, one row per chunk
 * Search is exact (dot product over every row): fine for course-sized
 * material (tens of thousands of chunks) and fully portable.
 */

export interface RagSource {
  path: string;
  chunks: number;
  pages: number;
  addedAt: string;
  /** Fingerprint of the file when it was indexed: an unchanged file is skipped when added again. */
  size?: number;
  modifiedAt?: string;
}

export interface RagManifest {
  id: string;
  name: string;
  description: string;
  model: string;
  dims: number;
  createdAt: string;
  updatedAt: string;
  sources: RagSource[];
}

export interface Chunk {
  source: string;
  page: number;
  text: string;
}

export interface RagIndex {
  manifest: RagManifest;
  chunks: Chunk[];
  vectors: Float32Array;
}

export interface Hit extends Chunk {
  score: number;
}

export const CHUNK_SIZE = 1200;
export const CHUNK_OVERLAP = 200;

export function ragId(name: string): string {
  return (
    name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'rag'
  );
}

/**
 * Splits pages into overlapping chunks, preferring paragraph and sentence
 * boundaries so a chunk rarely cuts a sentence in half.
 */
export function chunkPages(pages: string[], size = CHUNK_SIZE, overlap = CHUNK_OVERLAP): { page: number; text: string }[] {
  const out: { page: number; text: string }[] = [];
  pages.forEach((raw, index) => {
    const text = raw.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    let start = 0;
    while (start < text.length) {
      let end = Math.min(text.length, start + size);
      if (end < text.length) {
        const window = text.slice(start + Math.floor(size * 0.6), end);
        const cut = Math.max(window.lastIndexOf('\n\n'), window.lastIndexOf('. '), window.lastIndexOf('\n'));
        if (cut > 0) end = start + Math.floor(size * 0.6) + cut + 1;
      }
      const piece = text.slice(start, end).trim();
      if (piece.length >= 20) out.push({ page: index + 1, text: piece });
      if (end >= text.length) break;
      start = Math.max(end - overlap, start + 1);
    }
  });
  return out;
}

export function normalize(vector: number[]): Float32Array {
  const out = Float32Array.from(vector);
  let norm = 0;
  for (const v of out) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < out.length; i++) out[i]! /= norm;
  return out;
}

export function search(index: RagIndex, query: Float32Array, k: number): Hit[] {
  const { dims } = index.manifest;
  if (query.length !== dims) throw new Error('The query embedding has a different size than this RAG (model changed?)');
  const scores: { i: number; score: number }[] = [];
  for (let row = 0; row < index.chunks.length; row++) {
    let dot = 0;
    const base = row * dims;
    for (let d = 0; d < dims; d++) dot += index.vectors[base + d]! * query[d]!;
    scores.push({ i: row, score: dot });
  }
  scores.sort((a, b) => b.score - a.score);
  return scores.slice(0, k).map(({ i, score }) => ({ ...index.chunks[i]!, score: Math.round(score * 1000) / 1000 }));
}

function parseIndex(manifest: Buffer, chunks: Buffer | null, vectors: Buffer | null): RagIndex {
  const parsed = JSON.parse(manifest.toString('utf8')) as RagManifest;
  const rows = chunks
    ? chunks
        .toString('utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Chunk)
    : [];
  const vec = vectors && vectors.length ? new Float32Array(vectors.buffer.slice(vectors.byteOffset, vectors.byteOffset + vectors.byteLength)) : new Float32Array(0);
  return { manifest: parsed, chunks: rows, vectors: vec };
}

/** A user's own collections inside their workspace, under `.rag/<id>/`. */
export class UserRags {
  constructor(private ws: WorkspacePort, private userId: string) {}

  private dir(id: string): string {
    return `.rag/${id}`;
  }

  async list(): Promise<RagManifest[]> {
    let entries;
    try {
      entries = await this.ws.list(this.userId, '.rag');
    } catch {
      return [];
    }
    const out: RagManifest[] = [];
    for (const entry of entries) {
      if (entry.type !== 'dir') continue;
      try {
        out.push(JSON.parse((await this.ws.read(this.userId, `${entry.path}/manifest.json`)).toString('utf8')) as RagManifest);
      } catch {
        // A half-written folder: ignore it.
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  async exists(id: string): Promise<boolean> {
    return (await this.ws.stat(this.userId, `${this.dir(id)}/manifest.json`)) !== null;
  }

  async load(id: string): Promise<RagIndex> {
    if (!(await this.exists(id))) throw new Error(`No RAG "${id}". Use rag_list to see the available ones.`);
    const read = async (file: string) => ((await this.ws.stat(this.userId, `${this.dir(id)}/${file}`)) ? this.ws.read(this.userId, `${this.dir(id)}/${file}`) : null);
    return parseIndex((await read('manifest.json'))!, await read('chunks.jsonl'), await read('vectors.f32'));
  }

  async save(index: RagIndex): Promise<void> {
    const dir = this.dir(index.manifest.id);
    const chunks = index.chunks.map((c) => JSON.stringify(c)).join('\n') + (index.chunks.length ? '\n' : '');
    await this.ws.write(this.userId, `${dir}/chunks.jsonl`, chunks);
    await this.ws.write(this.userId, `${dir}/vectors.f32`, Buffer.from(index.vectors.buffer, index.vectors.byteOffset, index.vectors.byteLength));
    // Manifest last: a crash mid-save leaves the previous manifest pointing at complete data more often than not.
    await this.ws.write(this.userId, `${dir}/manifest.json`, JSON.stringify(index.manifest, null, 2));
  }

  async remove(id: string): Promise<void> {
    if (!(await this.exists(id))) throw new Error(`No RAG "${id}"`);
    await this.ws.delete(this.userId, this.dir(id));
  }
}

/** Loads a shared (read-only) collection through the host's source. */
export async function loadShared(source: SharedRagSource, userId: string, id: string): Promise<RagIndex> {
  const manifest = await source.readFile(userId, id, 'manifest.json');
  if (!manifest) throw new Error(`No shared RAG "${id}"`);
  return parseIndex(manifest, await source.readFile(userId, id, 'chunks.jsonl'), await source.readFile(userId, id, 'vectors.f32'));
}
