import express from 'express';
import pool from '../db/pool.js';
import { authenticate } from '../middleware/auth.js';
import { generateOllamaResponse, streamOllamaResponse } from '../services/ollamaService.js';
import { buildCourseContext } from '../services/ragService.js';

const router = express.Router();

const normalizeTitle = (title = '') => {
  const trimmed = title.trim();
  if (trimmed.length >= 3) {
    return trimmed.slice(0, 255);
  }
  return 'New Chat';
};

const sendEvent = (res, type, payload) => {
  res.write(`event: ${type}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
};

const mapSourcesToLinks = (sources = []) =>
  sources.map((source) => ({
    ...source,
    url: source.courseId && source.documentId
      ? `/api/courses/${source.courseId}/documents/${source.documentId}/file`
      : null,
  }));

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

router.post('/:chatId/messages/stream', async (req, res) => {
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

  const chatResult = await pool.query('SELECT id FROM chats WHERE id = $1 AND user_id = $2', [chatId, req.user.id]);

  if (!chatResult.rows.length) {
    return res.status(404).json({ error: 'Chat not found' });
  }

  const historyResult = await pool.query(
    'SELECT sender, content FROM messages WHERE chat_id = $1 ORDER BY timestamp ASC',
    [chatId]
  );

  const conversation = historyResult.rows.map((msg) => ({
    role: msg.sender === 'user' ? 'user' : 'assistant',
    content: msg.content,
  }));
  conversation.push({ role: 'user', content });

  let ragContext = '';
  let sources = [];

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const sendError = (message) => {
    sendEvent(res, 'error', { message });
    res.end();
  };

  const userMessageResult = await pool.query(
    'INSERT INTO messages (chat_id, sender, content) VALUES ($1, $2, $3) RETURNING id, sender, content, timestamp',
    [chatId, 'user', content]
  );

  try {
    if (courseCode) {
      const courseResult = await pool.query('SELECT code FROM courses WHERE LOWER(code) = LOWER($1)', [courseCode]);

      if (!courseResult.rows.length) {
        return sendError('Course not found for this RAG selection');
      }

      sendEvent(res, 'status', { message: `Collecting matches for ${courseResult.rows[0].code}...` });

      const contextResult = await buildCourseContext({
        courseCode: courseResult.rows[0].code,
        question: content,
        onStatus: (message) => sendEvent(res, 'status', { message }),
      });

      ragContext = contextResult.context;
      sources = mapSourcesToLinks(contextResult.sources);
    }

    const enhancedConversation = ragContext
      ? [
          {
            role: 'system',
            content:
              'You are an academic assistant. Prioritize the provided course context and cite matching document names and page hints when responding.',
          },
          { role: 'system', content: ragContext },
          ...conversation,
        ]
      : conversation;

    sendEvent(res, 'status', { message: 'Generating answer...' });

    const stream = await streamOllamaResponse(enhancedConversation);
    let aiContent = '';

    for await (const token of stream) {
      aiContent += token;
      sendEvent(res, 'token', { content: token });
    }

    const trimmed = aiContent.trim();
    const aiMessageResult = await pool.query(
      'INSERT INTO messages (chat_id, sender, content) VALUES ($1, $2, $3) RETURNING id, sender, content, timestamp',
      [chatId, 'ai', trimmed || 'I could not generate a response.']
    );

    sendEvent(res, 'done', {
      userMessage: userMessageResult.rows[0],
      aiMessage: aiMessageResult.rows[0],
      sources,
    });
    res.end();
  } catch (error) {
    console.error('Streaming message error:', error);
    sendError(error.message || 'AI response failed');
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
        return res.status(404).json({ error: 'Course not found for this RAG selection' });
      }

      const contextResult = await buildCourseContext({ courseCode: courseResult.rows[0].code, question: content });
      ragContext = contextResult.context;
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
                'Answer as an academic assistant. Prioritize the course context when available and preserve tables or code blocks in a clear format.',
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
