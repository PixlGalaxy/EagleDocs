import axios from "axios";

// Ollama API configuration
const OLLAMA_BASE_URL = process.env.OLLAMA_API_URL || "http://localhost:11434";
// Note: read default model at call time to ensure latest env is used

/**
 * Send a message to Ollama and get a response
 * @param {string} prompt - The user's input prompt
 * @param {string} model - The model to use (defaults to llama2)
 * @returns {Promise<string>} - The model's response
 */
export async function generateResponse(prompt, model) {
  try {
    // Build candidate list in order of preference:
    // 1) model passed in request
    // 2) OLLAMA_MODEL env var
    // 3) OLLAMA_FALLBACK_ORDER env var (comma-separated)
    // 4) models returned by /api/tags (in order)
    // 5) final default 'llama2'
    const envModel = process.env.OLLAMA_MODEL;
    const fallbackOrder = (process.env.OLLAMA_FALLBACK_ORDER || "")
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    const candidates = [];
    if (model) candidates.push(model);
    if (envModel && !candidates.includes(envModel)) candidates.push(envModel);
    for (const m of fallbackOrder) {
      if (!candidates.includes(m)) candidates.push(m);
    }

    // Fetch available models from Ollama and append any not already in candidates
    try {
      const available = await getAvailableModels();
      if (Array.isArray(available)) {
        for (const entry of available) {
          const name = entry && (entry.name || entry.model || entry);
          if (name && !candidates.includes(name)) candidates.push(name);
        }
      }
    } catch (e) {
      console.warn('Could not fetch available models for fallback list:', e && e.message);
    }

    if (!candidates.includes('llama2')) candidates.push('llama2');

    // Try candidates in order until one succeeds
    let lastError = null;
    for (const candidate of candidates) {
      try {
        // attempt request with candidate model
        const payload = { model: candidate, prompt, stream: false };
        const response = await axios.post(`${OLLAMA_BASE_URL}/api/generate`, payload);
        return { text: response.data.response, model: candidate };
      } catch (err) {
        lastError = err;
        const status = err && err.response && err.response.status;
        console.warn(`Model ${candidate} failed with status ${status}:`, err && err.message);
        // try next candidate for common model errors
        if (![404, 400, 422].includes(status)) {
          // For other errors (e.g., network, 500) decide whether to continue or break.
          // We'll continue to try other candidates, but log prominently.
          console.warn(`Continuing to next candidate after error for model ${candidate}`);
        }
        continue;
      }
    }

    // If none succeeded, throw the last error (or a generic one)
    throw new Error(lastError && lastError.message ? `No candidate model succeeded: ${lastError.message}` : 'No candidate model succeeded');
  } catch (error) {
    console.error("Error in generateResponse:", error && error.message);
    throw error;
  }
}

/**
 * Stream a response from Ollama (for real-time streaming)
 * @param {string} prompt - The user's input prompt
 * @param {string} model - The model to use
 * @returns {Promise<Object>} - Axios response object with streaming data
 */
export async function streamResponse(prompt, model = DEFAULT_MODEL) {
  try {
    const selectedModel = model || process.env.OLLAMA_MODEL || "llama2";
    const response = await axios.post(
      `${OLLAMA_BASE_URL}/api/generate`,
      {
        model: selectedModel,
        prompt: prompt,
        stream: true,
      },
      {
        responseType: "stream",
      }
    );

    return response;
  } catch (error) {
    console.error("Error streaming from Ollama API:", error.message);
    throw new Error(`Failed to stream from Ollama: ${error.message}`);
  }
}

/**
 * Get list of available models from Ollama
 * @returns {Promise<Array>} - Array of available models
 */
export async function getAvailableModels() {
  try {
    const response = await axios.get(`${OLLAMA_BASE_URL}/api/tags`);
    return response.data.models || [];
  } catch (error) {
    console.error("Error fetching models from Ollama:", error.message);
    throw new Error(`Failed to fetch models from Ollama: ${error.message}`);
  }
}

/**
 * Check if Ollama is running and accessible
 * @returns {Promise<boolean>} - True if Ollama is accessible
 */
export async function checkOllamaHealth() {
  try {
    await axios.get(`${OLLAMA_BASE_URL}/api/tags`, { timeout: 5000 });
    return true;
  } catch (error) {
    console.error("Ollama is not accessible:", error.message);
    return false;
  }
}
