import express from 'express';
import jwt from 'jsonwebtoken';
import pool from '../db/pool.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { authenticate } from '../middleware/auth.js';
import { COOKIE_NAME, getCookieOptions } from '../utils/cookies.js';
import { deriveRoleFromEmail } from '../utils/role.js';

const router = express.Router();

const createToken = (userId) =>
  jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '7d' });

const sanitizeUser = ({ password_hash, ...rest }) => ({ ...rest, role: deriveRoleFromEmail(rest.email) });

const isValidEmail = (email) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '');

router.post('/register', async (req, res) => {
  const { email, password } = req.body || {};

  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'A valid email address is required' });
  }

  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters long' });
  }

  const username = email.split('@')[0];

  try {
    const hashedPassword = await hashPassword(password);
    const { rows } = await pool.query(
      'INSERT INTO users (email, username, password_hash) VALUES ($1, $2, $3) RETURNING id, email, username, created_at',
      [email.toLowerCase(), username, hashedPassword]
    );

    const user = rows[0];
    const token = createToken(user.id);
    res.cookie(COOKIE_NAME, token, getCookieOptions());
    return res.status(201).json({ user: sanitizeUser(user) });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }
    console.error('Register error:', error);
    return res.status(500).json({ error: 'Unable to register user' });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};

  if (!isValidEmail(email) || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const { rows } = await pool.query(
      'SELECT id, email, username, password_hash, created_at FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (!rows.length) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = rows[0];
    const passwordsMatch = await verifyPassword(password, user.password_hash);

    if (!passwordsMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = createToken(user.id);
    res.cookie(COOKIE_NAME, token, getCookieOptions());
    return res.json({ user: sanitizeUser(user) });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Unable to log in' });
  }
});

router.post('/logout', (req, res) => {
  res.cookie(COOKIE_NAME, '', { ...getCookieOptions(), maxAge: 0 });
  return res.json({ success: true });
});

router.get('/me', authenticate, (req, res) => {
  return res.json({ user: req.user });
});

export default router;
