import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import pdfParse from 'pdf-parse';
import pool from '../db/pool.js';

export const COURSE_STORAGE_PATH =
  process.env.RAG_STORAGE_PATH || path.join(process.cwd(), 'backend', 'storage', 'courses');

export const ensureStoragePath = async () => {
  await fsPromises.mkdir(COURSE_STORAGE_PATH, { recursive: true });
};

export const ensureRagSchema = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS courses (
      id SERIAL PRIMARY KEY,
      code VARCHAR(50) UNIQUE NOT NULL,
      title VARCHAR(255),
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS course_documents (
      id SERIAL PRIMARY KEY,
      course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT,
      file_size INTEGER,
      text_content TEXT,
      uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(
    'ALTER TABLE chats ADD COLUMN IF NOT EXISTS course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL'
  );
};

export const extractTextFromPdf = async (filePath) => {
  const buffer = await fsPromises.readFile(filePath);
  const data = await pdfParse(buffer);
  return (data.text || '').trim();
};

export const saveCourseDocument = async ({ courseId, userId, file }) => {
  const textContent = await extractTextFromPdf(file.path);

  const { rows } = await pool.query(
    `INSERT INTO course_documents
      (course_id, filename, original_name, mime_type, file_size, text_content, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, course_id, filename, original_name, mime_type, file_size, uploaded_at`,
    [
      courseId,
      file.filename,
      file.originalname,
      file.mimetype,
      file.size,
      textContent,
      userId,
    ]
  );

  return rows[0];
};

export const getCourseByCode = async (code) => {
  const { rows } = await pool.query('SELECT id, code, title FROM courses WHERE code = $1', [code]);
  return rows[0] || null;
};

export const buildCoursePrompt = async (courseId) => {
  if (!courseId) return null;

  const courseResult = await pool.query('SELECT id, code, title FROM courses WHERE id = $1', [courseId]);
  if (!courseResult.rows.length) return null;
  const course = courseResult.rows[0];

  const { rows: docs } = await pool.query(
    `SELECT text_content
     FROM course_documents
     WHERE course_id = $1 AND text_content IS NOT NULL
     ORDER BY uploaded_at DESC
     LIMIT 5`,
    [courseId]
  );

  const snippets = docs
    .map((doc, idx) => `Document ${idx + 1} excerpt:\n${doc.text_content.trim().slice(0, 2000)}`)
    .filter(Boolean);

  const combined = snippets.join('\n\n---\n\n');
  const limited = combined.slice(0, 8000);

  return {
    course,
    prompt:
      limited.length > 0
        ? `You are assisting with the course ${course.code}${
            course.title ? ` (${course.title})` : ''
          }. Rely strictly on these course documents when relevant. If the documents do not contain the answer, say so.\n\n${limited}`
        : `You are assisting with the course ${course.code}${
            course.title ? ` (${course.title})` : ''
          }. There are currently no documents, so respond as a helpful general tutor while noting the lack of course material.`,
  };
};

export const cleanupFile = async (filePath) => {
  if (!filePath) return;
  try {
    await fsPromises.unlink(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('Failed to remove file', error);
    }
  }
};

export const isPdf = (mimetype = '') => mimetype.toLowerCase() === 'application/pdf';

export const fileExists = (filePath) => fs.existsSync(filePath);
