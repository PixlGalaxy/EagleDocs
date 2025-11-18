import jwt from 'jsonwebtoken';
import pool from '../db/pool.js';
import { COOKIE_NAME } from '../utils/cookies.js';

export const authenticate = async (req, res, next) => {
  const token = req.cookies?.[COOKIE_NAME];

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const { rows } = await pool.query(
      'SELECT id, email, username, created_at FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (!rows.length) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    req.user = rows[0];
    next();
  } catch (error) {
    console.error('Auth error:', error.message);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};
