const BASE = '/api';

export class ApiError extends Error {
  status: number;
  /** The server's message key (e.g. `models.chooseDefault`), to react to one error in particular. */
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** The double-submit token: `__Host-csrf` over https, `csrf` in plain http dev. */
export function csrfToken(): string | undefined {
  const parts = document.cookie.split('; ');
  for (const name of ['__Host-csrf=', 'csrf=']) {
    const part = parts.find((p) => p.startsWith(name));
    if (part) return part.slice(name.length);
  }
  return undefined;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const token = csrfToken();
  if (token && init?.method && init.method !== 'GET') headers.set('X-CSRF-Token', decodeURIComponent(token));

  const res = await fetch(`${BASE}${path}`, { credentials: 'include', ...init, headers });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, body.error ?? 'Unknown error', typeof body.code === 'string' ? body.code : undefined);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, form: FormData) => request<T>(path, { method: 'POST', body: form }),
};

/** Same base as the JSON helpers, for <img src>, downloads and EventSource. */
export const apiUrl = (path: string) => `${BASE}${path}`;
