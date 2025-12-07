import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

export const DOCUMENTS_DIR = process.env.DOCUMENTS_DIR || path.join(ROOT_DIR, 'storage', 'documents');
export const RAG_INDEX_DIR = process.env.RAG_INDEX_DIR || path.join(ROOT_DIR, 'storage', 'rag');

const sanitizeSegment = (value = '') => value.toString().trim().replace(/[^a-zA-Z0-9_-]/g, '-');

export const buildScopedDir = ({
  baseDir,
  academicYear,
  instructorEmail,
  courseCode,
  crn,
}) => {
  const year = sanitizeSegment(academicYear || new Date().getFullYear());
  const instructor = sanitizeSegment(instructorEmail || 'instructor');
  const courseSegment = sanitizeSegment(courseCode || 'course');
  const crnSegment = sanitizeSegment(crn || courseSegment);
  return path.join(baseDir, year, instructor, `${courseSegment}-${crnSegment}`);
};

export const ensureStorage = () => {
  [DOCUMENTS_DIR, RAG_INDEX_DIR].forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
};
