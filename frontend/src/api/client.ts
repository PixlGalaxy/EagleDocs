import { dictionaries, isLanguage } from '../i18n/translations';

const BASE = '/api';

/** Statuses a proxy answers with when StudyHawk itself does not (restarting, down, too slow). */
const GATEWAY_ERRORS = new Set([502, 503, 504]);

/** Fired when StudyHawk does not answer at all; the reconnecting screen listens for it (ReconnectOverlay). */
export const UNREACHABLE_EVENT = 'studyhawk:unreachable';
const unreachable = () => window.dispatchEvent(new Event(UNREACHABLE_EVENT));

/** "Could not reach the server..." in the page's language. */
function unreachableMessage(): string {
  const lang = document.documentElement.lang;
  return dictionaries[isLanguage(lang) ? lang : 'en']['common.networkError'];
}

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

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { credentials: 'include', ...init, headers });
  } catch (err) {
    // A cancelled request is not the server being down.
    if ((err as Error).name === 'AbortError') throw err;
    unreachable();
    throw new ApiError(0, unreachableMessage(), 'network');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    // No answer from StudyHawk itself (the server is restarting or down, and the proxy replied):
    // say so in the app's words, never the proxy's "Bad Gateway".
    if (typeof body?.error !== 'string' && GATEWAY_ERRORS.has(res.status)) {
      unreachable();
      throw new ApiError(res.status, unreachableMessage(), 'network');
    }
    throw new ApiError(res.status, body?.error ?? res.statusText ?? 'Unknown error', typeof body?.code === 'string' ? body.code : undefined);
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
