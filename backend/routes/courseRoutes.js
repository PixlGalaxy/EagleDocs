import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import pool from '../db/pool.js';
import { authenticate } from '../middleware/auth.js';
import { DOCUMENTS_DIR } from '../config/storage.js';
import { buildCourseContext, extractTextFromBuffer, storeCourseChunks } from '../services/ragService.js';

const router = express.Router();

const isInstructor = (user) => user?.role === 'instructor';

const normalizeCourseCode = (code = '') => code.trim().toUpperCase();

router.use(authenticate);

router.get('/', async (req, res) => {
  const ownedOnly = req.query.scope === 'mine';
  const params = [];
  const whereClause = ownedOnly ? 'WHERE c.owner_id = $1' : '';

  if (ownedOnly) {
    params.push(req.user.id);
  }

  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.code, c.name, c.description, c.owner_id, c.created_at, COUNT(cd.id) as document_count
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
    return res.status(403).json({ error: 'Solo los instructores pueden crear cursos' });
  }

  const code = normalizeCourseCode(req.body?.code || '');
  const name = (req.body?.name || '').trim();
  const description = (req.body?.description || '').trim();

  if (!code || code.length < 3 || code.length > 32) {
    return res.status(400).json({ error: 'Ingresa un código de curso válido' });
  }

  if (!name) {
    return res.status(400).json({ error: 'El curso necesita un nombre' });
  }

  try {
    const { rows } = await pool.query(
      'INSERT INTO courses (code, name, description, owner_id) VALUES ($1, $2, $3, $4) RETURNING *',
      [code, name.slice(0, 255), description || null, req.user.id]
    );

    return res.status(201).json({ course: rows[0] });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Ya existe un curso con este código' });
    }
    console.error('Create course error:', error);
    return res.status(500).json({ error: 'Unable to create course' });
  }
});

router.get('/:courseId/documents', async (req, res) => {
  const courseId = Number(req.params.courseId);

  if (Number.isNaN(courseId)) {
    return res.status(400).json({ error: 'ID de curso inválido' });
  }

  try {
    const courseResult = await pool.query('SELECT id, owner_id FROM courses WHERE id = $1', [courseId]);

    if (!courseResult.rows.length) {
      return res.status(404).json({ error: 'Curso no encontrado' });
    }

    if (!isInstructor(req.user) || courseResult.rows[0].owner_id !== req.user.id) {
      return res.status(403).json({ error: 'Solo el instructor puede ver estos archivos' });
    }

    const { rows } = await pool.query(
      'SELECT id, original_name, uploaded_at, size_bytes, mime_type FROM course_documents WHERE course_id = $1 ORDER BY uploaded_at DESC',
      [courseId]
    );

    return res.json({ documents: rows });
  } catch (error) {
    console.error('List course documents error:', error);
    return res.status(500).json({ error: 'Unable to load documents' });
  }
});

router.post('/:courseId/documents', async (req, res) => {
  const courseId = Number(req.params.courseId);

  if (Number.isNaN(courseId)) {
    return res.status(400).json({ error: 'ID de curso inválido' });
  }

  if (!isInstructor(req.user)) {
    return res.status(403).json({ error: 'Solo los instructores pueden subir documentos' });
  }

  const { fileName, fileData } = req.body || {};

  if (!fileName || !fileData) {
    return res.status(400).json({ error: 'Archivo PDF requerido' });
  }

  if (!fileName.toLowerCase().endsWith('.pdf')) {
    return res.status(400).json({ error: 'Solo se permiten archivos PDF' });
  }

  const courseResult = await pool.query('SELECT id, code, owner_id FROM courses WHERE id = $1', [courseId]);

  if (!courseResult.rows.length) {
    return res.status(404).json({ error: 'Curso no encontrado' });
  }

  if (courseResult.rows[0].owner_id !== req.user.id) {
    return res.status(403).json({ error: 'Solo el instructor del curso puede subir archivos' });
  }

  let buffer;
  try {
    buffer = Buffer.from(fileData, 'base64');
  } catch (error) {
    return res.status(400).json({ error: 'Archivo inválido' });
  }

  if (!buffer || !buffer.length) {
    return res.status(400).json({ error: 'No se pudo leer el archivo' });
  }

  const maxSize = 20 * 1024 * 1024; // 20MB
  if (buffer.length > maxSize) {
    return res.status(413).json({ error: 'El archivo supera el límite de 20MB' });
  }

  const safeName = `${Date.now()}-${fileName.replace(/[^a-zA-Z0-9._-]/g, '')}`;
  const targetPath = path.join(DOCUMENTS_DIR, safeName);

  const client = await pool.connect();

  try {
    await fs.writeFile(targetPath, buffer);
    const extractedText = extractTextFromBuffer(buffer);

    await client.query('BEGIN');
    const insertResult = await client.query(
      `INSERT INTO course_documents (course_id, file_name, original_name, mime_type, size_bytes)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [courseId, targetPath, fileName, 'application/pdf', buffer.length]
    );

    const documentId = insertResult.rows[0].id;
    const { indexPath, chunkCount } = await storeCourseChunks(courseResult.rows[0].code, documentId, extractedText);

    const { rows } = await client.query(
      `UPDATE course_documents
       SET text_content = $1, index_path = $2
       WHERE id = $3
       RETURNING id, original_name, uploaded_at, size_bytes, mime_type, text_content`,
      [extractedText.slice(0, 2000), indexPath, documentId]
    );

    await client.query('COMMIT');

    return res.status(201).json({
      document: rows[0],
      chunks: chunkCount,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Upload document error:', error);
    return res.status(500).json({ error: 'No se pudo guardar el documento' });
  } finally {
    client.release();
  }
});

router.get('/context/:courseCode', async (req, res) => {
  const courseCode = req.params.courseCode || '';
  const question = req.query.q || 'context preview';

  try {
    const context = await buildCourseContext(courseCode, question);
    return res.json({ context });
  } catch (error) {
    console.error('Preview context error:', error);
    return res.status(500).json({ error: 'No se pudo generar el contexto' });
  }
});

export default router;
