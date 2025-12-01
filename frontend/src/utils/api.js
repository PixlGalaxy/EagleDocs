const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.MODE === 'development' ? 'http://localhost:5000/api' : '/api');

const buildConfig = (options = {}) => {
  const isFormData = options.body instanceof FormData;
  const headers = {
    ...(options.headers || {}),
    ...(!isFormData ? { 'Content-Type': 'application/json' } : {}),
  };

  const config = {
    credentials: 'include',
    ...options,
    headers,
  };

  if (!isFormData && config.body && typeof config.body !== 'string') {
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

export { API_BASE_URL };
