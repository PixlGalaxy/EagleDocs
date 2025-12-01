import fs from 'fs/promises';
import path from 'path';
import zlib from 'zlib';
import pool from '../db/pool.js';
import { RAG_INDEX_DIR } from '../config/storage.js';

const sanitizeCourseCode = (code = '') => code.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');

const getIndexFileName = (courseCode, documentId) =>
  path.join(RAG_INDEX_DIR, `${sanitizeCourseCode(courseCode)}-${documentId}.json`);

const decodePdfStreams = (buffer) => {
  const binary = buffer.toString('binary');
  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  const segments = [];

  let match;
  while ((match = streamRegex.exec(binary)) !== null) {
    const streamContent = match[1];
    const streamStart = Math.max(0, match.index - 200);
    const header = binary.slice(streamStart, match.index);
    const hasFlate = /\/FlateDecode/.test(header);
    let data = Buffer.from(streamContent, 'binary');

    if (hasFlate) {
      try {
        data = zlib.inflateSync(data);
      } catch {
        // If the stream cannot be inflated, fall back to the raw bytes.
      }
    }

    segments.push(data.toString('utf8'));
  }

  return segments;
};

export const extractTextFromBuffer = (buffer) => {
  const decodedSegments = decodePdfStreams(buffer);
  const extracted = decodedSegments
    .flatMap((segment) => Array.from(segment.matchAll(/\(([^()]+)\)/g)).map((m) => m[1]))
    .join(' ')
    .replace(/\\n/g, ' ');

  const cleaned = extracted.replace(/\s+/g, ' ').trim();

  if (cleaned) {
    return cleaned;
  }

  const raw = buffer.toString('latin1');
  const matches = raw.match(/[\x20-\x7E]{3,}/g) || [];
  const fallback = matches.join(' ');
  return fallback.replace(/\s+/g, ' ').trim();
};

const chunkText = (text = '', chunkSize = 1200) => {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks = [];
  for (let i = 0; i < words.length; i += chunkSize) {
    chunks.push(words.slice(i, i + chunkSize).join(' '));
  }
  return chunks;
};

export const storeCourseChunks = async (courseCode, documentId, text) => {
  const cleaned = (text || '').trim();

  if (!cleaned) {
    return { indexPath: null, chunkCount: 0 };
  }

  const chunks = chunkText(cleaned);
  const indexPath = getIndexFileName(courseCode, documentId);
  await fs.writeFile(indexPath, JSON.stringify(chunks, null, 2), 'utf-8');
  return { indexPath, chunkCount: chunks.length };
};

const readIndexFiles = async (indexPaths = []) => {
  const chunkGroups = await Promise.all(
    indexPaths.map(async (indexPath) => {
      try {
        const contents = await fs.readFile(indexPath, 'utf-8');
        return JSON.parse(contents);
      } catch (error) {
        console.error(`Unable to read index ${indexPath}`, error.message);
        return [];
      }
    })
  );
  return chunkGroups.flat();
};

export const buildCourseContext = async (courseCode, question) => {
  const { rows } = await pool.query(
    `SELECT cd.index_path FROM course_documents cd JOIN courses c ON c.id = cd.course_id WHERE LOWER(c.code) = LOWER($1)`,
    [courseCode]
  );

  if (!rows.length) {
    return '';
  }

  const indexPaths = rows
    .map((row) => row.index_path)
    .filter(Boolean)
    .map((p) => path.resolve(p));
  const chunks = await readIndexFiles(indexPaths);

  if (!chunks.length) {
    return '';
  }

  const keywords = question
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 3);

  const scored = chunks
    .map((chunk) => {
      const lowered = chunk.toLowerCase();
      const score = keywords.reduce((acc, word) => (lowered.includes(word) ? acc + 1 : acc), 0);
      return { chunk, score };
    })
    .sort((a, b) => b.score - a.score);

  const topChunks = scored.slice(0, 5).map((entry) => entry.chunk.trim()).filter(Boolean);

  if (!topChunks.length) {
    return '';
  }

  const context = topChunks.join('\n\n');
  return `Course context ${courseCode}:\n${context.slice(0, 8000)}`;
};
