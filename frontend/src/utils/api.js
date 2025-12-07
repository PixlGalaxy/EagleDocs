const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.MODE === 'development' ? 'http://localhost:5000/api' : '/api');

// Helpful when building absolute links to files (e.g., PDF sources) without doubling "/api"
const API_ORIGIN = API_BASE_URL.replace(/\/api$/, '');

const buildConfig = (options = {}) => {
  const config = {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  };

  if (config.body && typeof config.body !== 'string') {
    config.body = JSON.stringify(config.body);
  }

  return config;
};

export const apiRequest = async (path, options = {}) => {
  let response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, buildConfig(options));
  } catch (error) {
    throw new Error(error.message || 'Network request failed');
  }
  const text = await response.text();
  let data;

  try {
    data = text ? JSON.parse(text) : null;
  } catch (error) {
    data = null;
  }

  if (!response.ok) {
    const message = data?.error || data?.message || 'Request failed';
    throw new Error(message);
  }

  return data ?? {};
};

export { API_BASE_URL, API_ORIGIN };
