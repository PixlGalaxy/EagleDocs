import fs from 'fs/promises';
import path from 'path';
import zlib from 'zlib';
import pool from '../db/pool.js';
import { RAG_INDEX_DIR, buildScopedDir } from '../config/storage.js';
import { runOllamaRelevanceCheck } from './ollamaService.js';

const sanitizeSegment = (value = '') => value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');

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
    const start = i;
    const end = Math.min(i + chunkSize, words.length);
    const chunkWords = words.slice(start, end).join(' ');
    const pageEstimate = Math.max(1, Math.floor(start / 500) + 1);
    chunks.push({ text: chunkWords, start, page: pageEstimate });
  }
  return chunks;
};

const ensureDir = async (dir) => {
  await fs.mkdir(dir, { recursive: true });
};

export const buildCourseStorageFolder = async ({ course, instructorEmail }) => {
  const scopedDir = buildScopedDir({
    baseDir: RAG_INDEX_DIR,
    academicYear: course.academic_year,
    instructorEmail,
    courseCode: course.code,
    crn: course.crn,
  });
  await ensureDir(scopedDir);
  return scopedDir;
};

export const storeCourseChunks = async ({ course, documentId, documentName, text, instructorEmail }) => {
  const cleaned = (text || '').trim();

  if (!cleaned) {
    return { indexPath: null, chunkCount: 0 };
  }

  const chunks = chunkText(cleaned);
  const folder = await buildCourseStorageFolder({ course, instructorEmail });
  const indexPath = path.join(folder, `${sanitizeSegment(course.code)}-${documentId}.json`);
  const payload = {
    document: {
      id: documentId,
      name: documentName,
      courseCode: course.code,
      crn: course.crn,
      academicYear: course.academic_year,
    },
    chunks: chunks.map((chunk) => ({
      text: chunk.text,
      meta: {
        page: chunk.page,
        documentId,
        documentName,
        courseCode: course.code,
        crn: course.crn,
        academicYear: course.academic_year,
      },
    })),
  };
  await fs.writeFile(indexPath, JSON.stringify(payload, null, 2), 'utf-8');
  return { indexPath, chunkCount: chunks.length, folder };
};

const readIndexFiles = async (indexPaths = []) => {
  const chunkGroups = await Promise.all(
    indexPaths.map(async (indexPath) => {
      try {
        const contents = await fs.readFile(indexPath, 'utf-8');
        const parsed = JSON.parse(contents);
        return parsed?.chunks?.length ? parsed.chunks : [];
      } catch (error) {
        console.error(`Unable to read index ${indexPath}`, error.message);
        return [];
      }
    })
  );
  return chunkGroups.flat();
};

const scoreChunks = (chunks, question) => {
  const keywords = question
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 3);

  return chunks
    .map((entry) => {
      const lowered = (entry.text || '').toLowerCase();
      const score = keywords.reduce((acc, word) => (lowered.includes(word) ? acc + 1 : acc), 0);
      return { ...entry, score };
    })
    .sort((a, b) => b.score - a.score);
};

const summarizeChunks = (chunks = []) => chunks.map((chunk) => chunk.text.trim()).join('\n\n');

export const buildCourseContext = async ({ courseCode, question, onStatus = () => {} }) => {
  const { rows } = await pool.query(
    `SELECT cd.id, cd.index_path, cd.original_name, cd.file_name, c.id as course_id, c.code, c.crn, c.academic_year
     FROM course_documents cd
     JOIN courses c ON c.id = cd.course_id
     WHERE LOWER(c.code) = LOWER($1)`,
    [courseCode]
  );

  if (!rows.length) {
    return { context: '', sources: [] };
  }

  const indexPaths = rows.map((row) => row.index_path).filter(Boolean).map((p) => path.resolve(p));
  const chunks = await readIndexFiles(indexPaths);

  if (!chunks.length) {
    return { context: '', sources: [] };
  }

  const scored = scoreChunks(chunks, question);
  const topChunks = scored.slice(0, 12).filter((entry) => entry.score > 0 || scored.length <= 12);

  const groupedByDocument = new Map();
  topChunks.forEach((chunk) => {
    const key = chunk.meta.documentId;
    if (!groupedByDocument.has(key)) {
      groupedByDocument.set(key, []);
    }
    groupedByDocument.get(key).push(chunk);
  });

  const sources = [];
  const approvedContexts = [];

  for (const [documentId, chunkList] of groupedByDocument.entries()) {
    const meta = chunkList[0]?.meta || {};
    const documentRow = rows.find((row) => row.id === documentId);
    const snippet = summarizeChunks(chunkList.slice(0, 3));

    onStatus(`Checking ${meta.documentName || documentRow?.original_name || 'document'}...`);

    const relevance = await runOllamaRelevanceCheck({
      question,
      snippet,
      documentName: meta.documentName || documentRow?.original_name,
      courseCode: meta.courseCode,
      crn: meta.crn,
    });

    if (!relevance.relevant) {
      continue;
    }

    const minPage = Math.min(...chunkList.map((chunk) => chunk.meta.page || 1));
    const maxPage = Math.max(...chunkList.map((chunk) => chunk.meta.page || 1));

    approvedContexts.push({
      text: snippet,
      documentName: meta.documentName || documentRow?.original_name,
      pageRange: { start: minPage, end: maxPage },
      documentId,
      courseId: documentRow?.course_id,
      filePath: documentRow?.file_name,
    });

    sources.push({
      documentId,
      documentName: meta.documentName || documentRow?.original_name,
      pageRange: { start: minPage, end: maxPage },
      courseId: documentRow?.course_id,
      filePath: documentRow?.file_name,
    });
  }

  if (!approvedContexts.length) {
    return { context: '', sources: [] };
  }

  const contextText = approvedContexts
    .map((entry) => {
      const pages = entry.pageRange.start === entry.pageRange.end
        ? `page ${entry.pageRange.start}`
        : `pages ${entry.pageRange.start}-${entry.pageRange.end}`;
      return `Document: ${entry.documentName} (${pages})\n${entry.text}`;
    })
    .join('\n\n---\n\n');

  return {
    context: `Course context ${courseCode}:\n${contextText.slice(0, 10000)}`,
    sources,
  };
};
