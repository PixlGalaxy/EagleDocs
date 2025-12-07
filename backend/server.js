import './config/env.js';
import express from 'express';
import cors from 'cors';
import cookie from 'cookie';
import pool from './db/pool.js';
import authRoutes from './routes/authRoutes.js';
import chatRoutes from './routes/chatRoutes.js';
import courseRoutes from './routes/courseRoutes.js';
import ensureSchema from './db/schema.js';
import { ensureStorage } from './config/storage.js';

const app = express();
const PORT = process.env.PORT || 5000;
const NODE_ENV = process.env.NODE_ENV || 'development';

if (NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

const allowedOrigins = process.env.CLIENT_ORIGIN
  ? process.env.CLIENT_ORIGIN.split(',').map((origin) => origin.trim())
  : NODE_ENV === 'development'
    ? ['http://localhost:5173']
    : [];

await ensureSchema();
ensureStorage();

app.use((req, res, next) => {
  req.cookies = req.headers?.cookie ? cookie.parse(req.headers.cookie) : {};
  next();
});

if (NODE_ENV !== 'development') {
  app.use(
    cors({
      credentials: true,
      origin(origin, callback) {
        if (!origin || !allowedOrigins.length || allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        return callback(new Error('Not allowed by CORS'));
      },
    })
  );
} else {
  console.log('CORS middleware is disabled in development mode.');
}

app.use(express.json({ limit: '25mb' }));

app.get('/api/dbtest', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ dbTime: result.rows[0] });
  } catch (err) {
    console.error('DB Error:', err);
    res.status(500).json({ error: 'Database connection failed' });
  }
});

app.get('/api/uptime', (req, res) => {
  res.json({ message: 'Hello from EagleDocs backend! - Backend Running' });
});

app.use('/api/auth', authRoutes);
app.use('/api/chats', chatRoutes);
app.use('/api/courses', courseRoutes);

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
