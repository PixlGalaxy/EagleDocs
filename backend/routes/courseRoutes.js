import express from 'express';
import multer from 'multer';
import pool from '../db/pool.js';
import { authenticate } from '../middleware/auth.js';
import { requireInstructor } from '../middleware/instructorOnly.js';
import {
  COURSE_STORAGE_PATH,
  ensureStoragePath,
  saveCourseDocument,
  cleanupFile,
  isPdf,
} from '../services/ragService.js';

const router = express.Router();

const storage = multer.diskStorage({
  async destination(req, file, cb) {
    try {
      await ensureStoragePath();
      cb(null, COURSE_STORAGE_PATH);
    } catch (error) {
      cb(error, COURSE_STORAGE_PATH);
    }
  },
  filename(req, file, cb) {
    const timestamp = Date.now();
    const sanitized = file.originalname.replace(/[^a-zA-Z0-9.\-]/g, '_');
    cb(null, `${timestamp}-${sanitized}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (isPdf(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  },
});

const validateCourseCode = (code = '') => /^[A-Za-z0-9_-]{2,20}$/.test(code.trim());

router.use(authenticate);

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.code, c.title, c.created_at, COUNT(d.id) AS document_count
       FROM courses c
       LEFT JOIN course_documents d ON d.course_id = c.id
       GROUP BY c.id
       ORDER BY c.code ASC`
    );

    return res.json({ courses: rows });
  } catch (error) {
    console.error('List courses error:', error);
    return res.status(500).json({ error: 'Unable to load courses' });
  }
});

router.post('/', requireInstructor, async (req, res) => {
  const { code = '', title = '' } = req.body || {};
  const trimmedCode = code.trim();
  const trimmedTitle = title.trim();

  if (!validateCourseCode(trimmedCode)) {
    return res.status(400).json({ error: 'Course code must be 2-20 characters (letters, numbers, - or _)' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO courses (code, title, created_by) VALUES ($1, $2, $3)
       ON CONFLICT (code) DO UPDATE SET title = EXCLUDED.title
       RETURNING id, code, title, created_at`,
      [trimmedCode.toUpperCase(), trimmedTitle || null, req.user.id]
    );

    return res.status(201).json({ course: rows[0] });
  } catch (error) {
    console.error('Create course error:', error);
    return res.status(500).json({ error: 'Unable to save course' });
  }
});

router.get('/:courseId/documents', requireInstructor, async (req, res) => {
  const courseId = Number(req.params.courseId);

  if (Number.isNaN(courseId)) {
    return res.status(400).json({ error: 'Invalid course id' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT id, original_name, filename, mime_type, file_size, uploaded_at
       FROM course_documents WHERE course_id = $1 ORDER BY uploaded_at DESC`,
      [courseId]
    );

    return res.json({ documents: rows });
  } catch (error) {
    console.error('List documents error:', error);
    return res.status(500).json({ error: 'Unable to load documents' });
  }
});

router.post(
  '/:courseId/documents',
  requireInstructor,
  upload.single('file'),
  async (req, res) => {
    const courseId = Number(req.params.courseId);

    if (Number.isNaN(courseId)) {
      return res.status(400).json({ error: 'Invalid course id' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'A PDF file is required' });
    }

    let document;

    try {
      const courseResult = await pool.query('SELECT id FROM courses WHERE id = $1', [courseId]);
      if (!courseResult.rows.length) {
        await cleanupFile(req.file.path);
        return res.status(404).json({ error: 'Course not found' });
      }

      document = await saveCourseDocument({ courseId, userId: req.user.id, file: req.file });
      return res.status(201).json({ document });
    } catch (error) {
      await cleanupFile(req.file?.path);
      console.error('Upload document error:', error);
      return res.status(500).json({ error: 'Unable to save document' });
    }
  }
);

export default router;
