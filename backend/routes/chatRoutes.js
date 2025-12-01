import express from 'express';
import pool from '../db/pool.js';
import { authenticate } from '../middleware/auth.js';
import { generateOllamaResponse } from '../services/ollamaService.js';
import { buildCourseContext } from '../services/ragService.js';

const router = express.Router();

const normalizeTitle = (title = '') => {
  const trimmed = title.trim();
  if (trimmed.length >= 3) {
    return trimmed.slice(0, 255);
  }
  return 'New Chat';
};

router.use(authenticate);

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, title, created_at FROM chats WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.id]
    );
    return res.json({ chats: rows });
  } catch (error) {
    console.error('Fetch chats error:', error);
    return res.status(500).json({ error: 'Unable to load chats' });
  }
});

router.post('/', async (req, res) => {
  const title = normalizeTitle(req.body?.title);

  try {
    const { rows } = await pool.query(
      'INSERT INTO chats (user_id, title) VALUES ($1, $2) RETURNING id, title, created_at',
      [req.user.id, title]
    );
    return res.status(201).json({ chat: rows[0] });
  } catch (error) {
    console.error('Create chat error:', error);
    return res.status(500).json({ error: 'Unable to create chat' });
  }
});

router.get('/:chatId', async (req, res) => {
  const chatId = Number(req.params.chatId);

  if (Number.isNaN(chatId)) {
    return res.status(400).json({ error: 'Invalid chat id' });
  }

  try {
    const chatResult = await pool.query(
      'SELECT id, title, created_at FROM chats WHERE id = $1 AND user_id = $2',
      [chatId, req.user.id]
    );

    if (!chatResult.rows.length) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    const messagesResult = await pool.query(
      'SELECT id, sender, content, timestamp FROM messages WHERE chat_id = $1 ORDER BY timestamp ASC',
      [chatId]
    );

    return res.json({ chat: chatResult.rows[0], messages: messagesResult.rows });
  } catch (error) {
    console.error('Fetch chat error:', error);
    return res.status(500).json({ error: 'Unable to load chat' });
  }
});

router.post('/:chatId/messages', async (req, res) => {
  const chatId = Number(req.params.chatId);
  const content = (req.body?.content || '').trim();
  const courseCode = (req.body?.courseCode || '').trim();

  if (Number.isNaN(chatId)) {
    return res.status(400).json({ error: 'Invalid chat id' });
  }

  if (!content) {
    return res.status(400).json({ error: 'Message content is required' });
  }

  if (content.length > 4000) {
    return res.status(400).json({ error: 'Message is too long' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const chatResult = await client.query(
      'SELECT id FROM chats WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [chatId, req.user.id]
    );

    if (!chatResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Chat not found' });
    }

    const historyResult = await client.query(
      'SELECT sender, content FROM messages WHERE chat_id = $1 ORDER BY timestamp ASC',
      [chatId]
    );

    const conversation = historyResult.rows.map((msg) => ({
      role: msg.sender === 'user' ? 'user' : 'assistant',
      content: msg.content,
    }));
    conversation.push({ role: 'user', content });

    let ragContext = '';

    if (courseCode) {
      const courseResult = await client.query(
        'SELECT code FROM courses WHERE LOWER(code) = LOWER($1)',
        [courseCode]
      );

      if (!courseResult.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Curso no encontrado para esta RAG' });
      }

      ragContext = await buildCourseContext(courseResult.rows[0].code, content);
    }

    const userMessageResult = await client.query(
      'INSERT INTO messages (chat_id, sender, content) VALUES ($1, $2, $3) RETURNING id, sender, content, timestamp',
      [chatId, 'user', content]
    );

    let aiContent;
    try {
      const enhancedConversation = ragContext
        ? [
            {
              role: 'system',
              content:
                'Responde como asistente académico. Prioriza el contexto del curso si existe y mantén las tablas o bloques de código en formato claro.',
            },
            { role: 'system', content: ragContext },
            ...conversation,
          ]
        : conversation;
      aiContent = await generateOllamaResponse(enhancedConversation);
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Ollama error:', error.message);
      return res.status(502).json({ error: error.message || 'AI response failed' });
    }

    const aiMessageResult = await client.query(
      'INSERT INTO messages (chat_id, sender, content) VALUES ($1, $2, $3) RETURNING id, sender, content, timestamp',
      [chatId, 'ai', aiContent]
    );

    await client.query('COMMIT');

    return res.status(201).json({
      userMessage: userMessageResult.rows[0],
      aiMessage: aiMessageResult.rows[0],
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Send message error:', error);
    return res.status(500).json({ error: 'Unable to send message' });
  } finally {
    client.release();
  }
});

export default router;
