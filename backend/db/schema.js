import pool from './pool.js';

const ensureSchema = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS courses (
      id SERIAL PRIMARY KEY,
      code VARCHAR(32) UNIQUE NOT NULL,
      academic_year INTEGER DEFAULT EXTRACT(YEAR FROM NOW()),
      crn VARCHAR(32),
      name VARCHAR(255) NOT NULL,
      description TEXT,
      owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  await pool.query(`
    ALTER TABLE courses
    ADD COLUMN IF NOT EXISTS academic_year INTEGER DEFAULT EXTRACT(YEAR FROM NOW()),
    ADD COLUMN IF NOT EXISTS crn VARCHAR(32)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS course_documents (
      id SERIAL PRIMARY KEY,
      course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
      file_name TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT,
      size_bytes INTEGER,
      text_content TEXT,
      index_path TEXT,
      uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  await pool.query(`
    ALTER TABLE course_documents
    ADD COLUMN IF NOT EXISTS page_estimate INTEGER,
    ADD COLUMN IF NOT EXISTS storage_folder TEXT
  `);
};

export default ensureSchema;
