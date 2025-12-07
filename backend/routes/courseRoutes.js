import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import pool from '../db/pool.js';
import { authenticate } from '../middleware/auth.js';
import { DOCUMENTS_DIR, buildScopedDir } from '../config/storage.js';
import { buildCourseContext, extractTextFromBuffer, storeCourseChunks } from '../services/ragService.js';

const router = express.Router();

const isInstructor = (user) => user?.role === 'instructor';

const normalizeCourseCode = (code = '') => code.trim().toUpperCase();

const ensureDir = async (dir) => {
  await fs.mkdir(dir, { recursive: true });
};

router.use(authenticate);

router.get('/', async (req, res) => {
  const ownedOnly = req.query.scope === 'mine';
  const params = [];
  const conditions = [];

  if (ownedOnly) {
    params.push(req.user.id);
    conditions.push('c.owner_id = $1');
    conditions.push('NOT c.archived');
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.code, c.academic_year, c.crn, c.name, c.description, c.owner_id, c.created_at, COUNT(cd.id) as document_count
       FROM courses c
       LEFT JOIN course_documents cd ON cd.course_id = c.id
       ${whereClause}
       GROUP BY c.id
       ORDER BY c.created_at DESC`,
      params
    );

    return res.json({ courses: rows });
  } catch (error) {
    console.error('List courses error:', error);
    return res.status(500).json({ error: 'Unable to load courses' });
  }
});

router.post('/', async (req, res) => {
  if (!isInstructor(req.user)) {
    return res.status(403).json({ error: 'Only instructors can create courses' });
  }

  const code = normalizeCourseCode(req.body?.code || '');
  const name = (req.body?.name || '').trim();
  const description = (req.body?.description || '').trim();
  const academicYear = Number(req.body?.academicYear) || new Date().getFullYear();
  const crn = (req.body?.crn || '').trim();

  if (!code || code.length < 3 || code.length > 32) {
    return res.status(400).json({ error: 'Enter a valid course code' });
  }

  if (!name) {
    return res.status(400).json({ error: 'The course needs a name' });
  }

  if (academicYear < 2000 || academicYear > 3000) {
    return res.status(400).json({ error: 'Enter a valid academic year' });
  }

  if (!crn) {
    return res.status(400).json({ error: 'CRN is required to organize the course RAG' });
  }

  try {
    const { rows } = await pool.query(
      'INSERT INTO courses (code, name, description, owner_id, academic_year, crn) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [code, name.slice(0, 255), description || null, req.user.id, academicYear, crn || null]
    );

    return res.status(201).json({ course: rows[0] });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'A course with this code already exists' });
    }
    console.error('Create course error:', error);
    return res.status(500).json({ error: 'Unable to create course' });
  }
});

router.get('/:courseId/documents', async (req, res) => {
  const courseId = Number(req.params.courseId);

  if (Number.isNaN(courseId)) {
    return res.status(400).json({ error: 'Invalid course ID' });
  }

  try {
    const courseResult = await pool.query('SELECT id, owner_id FROM courses WHERE id = $1', [courseId]);

    if (!courseResult.rows.length) {
      return res.status(404).json({ error: 'Course not found' });
    }

    if (!isInstructor(req.user) || courseResult.rows[0].owner_id !== req.user.id) {
      return res.status(403).json({ error: 'Only the instructor can view these files' });
    }

    const { rows } = await pool.query(
      'SELECT id, original_name, uploaded_at, size_bytes, mime_type, page_estimate FROM course_documents WHERE course_id = $1 ORDER BY uploaded_at DESC',
      [courseId]
    );

    return res.json({ documents: rows });
  } catch (error) {
    console.error('List course documents error:', error);
    return res.status(500).json({ error: 'Unable to load documents' });
  }
});

router.delete('/:courseId', async (req, res) => {
  const courseId = Number(req.params.courseId);

  if (Number.isNaN(courseId)) {
    return res.status(400).json({ error: 'Invalid course ID' });
  }

  if (!isInstructor(req.user)) {
    return res.status(403).json({ error: 'Only instructors can archive courses' });
  }

  try {
    const result = await pool.query(
      'UPDATE courses SET archived = TRUE WHERE id = $1 AND owner_id = $2 AND archived = FALSE RETURNING id',
      [courseId, req.user.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Course not found or already archived' });
    }

    return res.json({ success: true });
  } catch (error) {
    console.error('Archive course error:', error);
    return res.status(500).json({ error: 'Unable to archive this course' });
  }
});

router.post('/:courseId/documents', async (req, res) => {
  const courseId = Number(req.params.courseId);

  if (Number.isNaN(courseId)) {
    return res.status(400).json({ error: 'Invalid course ID' });
  }

  if (!isInstructor(req.user)) {
    return res.status(403).json({ error: 'Only instructors can upload documents' });
  }

  const { fileName, fileData } = req.body || {};

  if (!fileName || !fileData) {
    return res.status(400).json({ error: 'PDF file required' });
  }

  if (!fileName.toLowerCase().endsWith('.pdf')) {
    return res.status(400).json({ error: 'Only PDF files are allowed' });
  }

  const courseResult = await pool.query(
    `SELECT c.id, c.code, c.owner_id, c.academic_year, c.crn, u.email as instructor_email
     FROM courses c
     JOIN users u ON u.id = c.owner_id
     WHERE c.id = $1`,
    [courseId]
  );

  if (!courseResult.rows.length) {
    return res.status(404).json({ error: 'Course not found' });
  }

  if (courseResult.rows[0].owner_id !== req.user.id) {
    return res.status(403).json({ error: 'Only the course instructor can upload files' });
  }

  let buffer;
  try {
    buffer = Buffer.from(fileData, 'base64');
  } catch (error) {
    return res.status(400).json({ error: 'Invalid file' });
  }

  if (!buffer || !buffer.length) {
    return res.status(400).json({ error: 'Unable to read the file' });
  }

  const maxSize = 20 * 1024 * 1024; // 20MB
  if (buffer.length > maxSize) {
    return res.status(413).json({ error: 'The file exceeds the 20MB limit' });
  }

  const safeName = `${Date.now()}-${fileName.replace(/[^a-zA-Z0-9._-]/g, '')}`;
  const scopedFolder = buildScopedDir({
    baseDir: DOCUMENTS_DIR,
    academicYear: courseResult.rows[0].academic_year,
    instructorEmail: courseResult.rows[0].instructor_email,
    courseCode: courseResult.rows[0].code,
    crn: courseResult.rows[0].crn,
  });
  await ensureDir(scopedFolder);
  const targetPath = path.join(scopedFolder, safeName);

  const client = await pool.connect();

  try {
    await fs.writeFile(targetPath, buffer);
    const extractedText = extractTextFromBuffer(buffer);

    if (!extractedText) {
      await client.query('ROLLBACK');
      await fs.unlink(targetPath);
      return res.status(422).json({ error: 'No readable text found in this PDF. Please upload a text-based PDF.' });
    }

    await client.query('BEGIN');
    const insertResult = await client.query(
      `INSERT INTO course_documents (course_id, file_name, original_name, mime_type, size_bytes, storage_folder)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [courseId, targetPath, fileName, 'application/pdf', buffer.length, scopedFolder]
    );

    const documentId = insertResult.rows[0].id;
    const { indexPath, chunkCount } = await storeCourseChunks({
      course: courseResult.rows[0],
      documentId,
      documentName: fileName,
      text: extractedText,
      instructorEmail: courseResult.rows[0].instructor_email,
    });
    const pageEstimate = Math.max(1, Math.ceil(extractedText.split(/\s+/).length / 500));

    const { rows } = await client.query(
      `UPDATE course_documents
       SET text_content = $1, index_path = $2, page_estimate = $3
       WHERE id = $4
       RETURNING id, original_name, uploaded_at, size_bytes, mime_type, text_content`,
      [extractedText.slice(0, 2000), indexPath, pageEstimate, documentId]
    );

    await client.query('COMMIT');

    return res.status(201).json({
      document: rows[0],
      chunks: chunkCount,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Upload document error:', error);
    return res.status(500).json({ error: 'Unable to save the document' });
  } finally {
    client.release();
  }
});

router.get('/context/:courseCode', async (req, res) => {
  const courseCode = req.params.courseCode || '';
  const question = req.query.q || 'context preview';

  try {
    const { context } = await buildCourseContext({ courseCode, question });
    return res.json({ context });
  } catch (error) {
    console.error('Preview context error:', error);
    return res.status(500).json({ error: 'Unable to build context' });
  }
});

router.get('/:courseId/documents/:documentId/file', async (req, res) => {
  const courseId = Number(req.params.courseId);
  const documentId = Number(req.params.documentId);

  if (Number.isNaN(courseId) || Number.isNaN(documentId)) {
    return res.status(400).json({ error: 'Invalid identifiers' });
  }

  try {
    const { rows } = await pool.query(
      'SELECT file_name, original_name FROM course_documents WHERE id = $1 AND course_id = $2',
      [documentId, courseId]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const filePath = rows[0].file_name;
    return res.sendFile(path.resolve(filePath));
  } catch (error) {
    console.error('Serve document error:', error);
    return res.status(500).json({ error: 'Unable to serve document' });
  }
});

export default router;
