import fetch from 'node-fetch';

const DEFAULT_TIMEOUT = 60000;

const getBaseUrl = () => {
  if (!process.env.OLLAMA_HOST || !process.env.OLLAMA_PORT) {
    throw new Error('Ollama connection settings are missing');
  }
  return `http://${process.env.OLLAMA_HOST}:${process.env.OLLAMA_PORT}`;
};

const decodeStreamChunks = async function* (response) {
  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const parts = buffer.split('\n');
    buffer = parts.pop() ?? '';

    for (const part of parts) {
      if (!part.trim()) continue;
      try {
        const parsed = JSON.parse(part);
        const token = parsed?.message?.content || parsed?.response || parsed?.delta;
        if (token) {
          yield token;
        }
      } catch {
        // Skip malformed chunks
      }
    }
  }

  if (buffer.trim()) {
    try {
      const parsed = JSON.parse(buffer.trim());
      const token = parsed?.message?.content || parsed?.response || parsed?.delta;
      if (token) {
        yield token;
      }
    } catch {
      // ignore
    }
  }
};

export const generateOllamaResponse = async (messages, modelOverride) => {
  const baseUrl = getBaseUrl();
  const model = modelOverride || process.env.OLLAMA_MODEL || 'gpt-oss:20b';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);

  try {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama error: ${errorText || response.statusText}`);
    }

    const data = await response.json();
    const content = data?.message?.content || data?.response;

    if (!content) {
      throw new Error('Ollama returned an empty response');
    }

    return content.trim();
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Ollama request timed out');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

export const streamOllamaResponse = async (messages, modelOverride) => {
  const baseUrl = getBaseUrl();
  const model = modelOverride || process.env.OLLAMA_MODEL || 'gpt-oss:20b';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);

  try {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: true }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama error: ${errorText || response.statusText}`);
    }

    return decodeStreamChunks(response);
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Ollama request timed out');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

export const runOllamaRelevanceCheck = async ({ question, snippet, documentName, courseCode, crn }) => {
  const model = process.env.RAG_ANALYSIS_MODEL || process.env.OLLAMA_MODEL || 'gpt-oss:20b';
  const prompt = `You are a JSON-only gatekeeper. Given a student question and a course PDF excerpt, respond only with JSON {"relevant":true|false,"reason":"short"} indicating whether the excerpt can answer the question. Include false if unsure.\nDocument: ${documentName || 'file'} (course ${courseCode || ''} crn ${crn || ''})\nExcerpt:\n${snippet}\nQuestion:\n${question}`;

  const content = await generateOllamaResponse(
    [
      { role: 'system', content: 'Return strictly valid JSON with keys relevant and reason.' },
      { role: 'user', content: prompt },
    ],
    model
  );

  try {
    const parsed = JSON.parse(content);
    const relevant = Boolean(parsed.relevant);
    const reason = parsed.reason || '';
    return { relevant, reason };
  } catch (error) {
    return { relevant: false, reason: 'Unable to parse analysis response' };
  }
};
