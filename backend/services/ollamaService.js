import fetch from 'node-fetch';

const DEFAULT_TIMEOUT = 60000;

export const generateOllamaResponse = async (messages) => {
  if (!process.env.OLLAMA_HOST || !process.env.OLLAMA_PORT) {
    throw new Error('Ollama connection settings are missing');
  }

  const baseUrl = `http://${process.env.OLLAMA_HOST}:${process.env.OLLAMA_PORT}`;
  const model = process.env.OLLAMA_MODEL || 'llama3';
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
