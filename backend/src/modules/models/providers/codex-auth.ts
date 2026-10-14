/**
 * "Sign in with ChatGPT" for Codex, server side. Wire details verified against
 * Hermes Agent's implementation (plans/03-fase2-chat-modelos.md, spike):
 * device flow on auth.openai.com with the Codex CLI's public client id; the
 * server hands back the PKCE verifier; refresh tokens rotate and are single use.
 */

export const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const ISSUER = 'https://auth.openai.com';
export const CODEX_VERIFY_URL = `${ISSUER}/codex/device`;
const DEVICE_REDIRECT = `${ISSUER}/deviceauth/callback`;
/** The device flow has no server-side expiry field; the client gives up after this. */
export const DEVICE_LOGIN_TTL_MS = 15 * 60 * 1000;
/** Refresh this long before the access token's `exp`. */
const REFRESH_SKEW_MS = 120_000;

export interface CodexTokens {
  access_token: string;
  refresh_token: string;
}

export class CodexAuthError extends Error {
  constructor(
    message: string,
    /** The refresh token is dead: the user has to connect again. */
    readonly relogin: boolean,
  ) {
    super(message);
  }
}

async function post(url: string, body: Record<string, string>, form: boolean): Promise<Response> {
  // Transient network errors get two more tries; HTTP errors are returned to the caller.
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fetch(url, {
        method: 'POST',
        headers: form
          ? { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }
          : { 'content-type': 'application/json' },
        body: form ? new URLSearchParams(body).toString() : JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  throw lastError;
}

/** Step 1: a code the user types at auth.openai.com/codex/device. */
export async function startDeviceLogin(): Promise<{ deviceAuthId: string; userCode: string; intervalSeconds: number }> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await post(`${ISSUER}/api/accounts/deviceauth/usercode`, { client_id: CODEX_CLIENT_ID }, false);
    if (res.status === 429) {
      const wait = Number(res.headers.get('retry-after')) || 2 ** attempt;
      await new Promise((r) => setTimeout(r, Math.min(60, Math.max(1, wait)) * 1000));
      continue;
    }
    if (!res.ok) throw new CodexAuthError(`OpenAI refused to start the login (${res.status})`, false);
    const json = (await res.json()) as { user_code?: string; device_auth_id?: string; interval?: string | number };
    if (!json.user_code || !json.device_auth_id) throw new CodexAuthError('OpenAI sent an unexpected login response', false);
    return { deviceAuthId: json.device_auth_id, userCode: json.user_code, intervalSeconds: Math.max(3, Number(json.interval ?? 5) || 5) };
  }
  throw new CodexAuthError('OpenAI is rate limiting logins right now. Try again in a minute.', false);
}

/**
 * Step 2, called repeatedly: null while the user has not approved yet (403/404),
 * the tokens once they have.
 */
export async function pollDeviceLogin(deviceAuthId: string, userCode: string): Promise<CodexTokens | null> {
  const res = await post(`${ISSUER}/api/accounts/deviceauth/token`, { device_auth_id: deviceAuthId, user_code: userCode }, false);
  if (res.status === 403 || res.status === 404) return null;
  if (!res.ok) throw new CodexAuthError(`OpenAI login failed (${res.status})`, false);
  const { authorization_code: code, code_verifier: verifier } = (await res.json()) as {
    authorization_code?: string;
    code_verifier?: string;
  };
  if (!code || !verifier) throw new CodexAuthError('OpenAI sent an unexpected login response', false);

  const exchange = await post(
    `${ISSUER}/oauth/token`,
    { grant_type: 'authorization_code', code, redirect_uri: DEVICE_REDIRECT, client_id: CODEX_CLIENT_ID, code_verifier: verifier },
    true,
  );
  if (!exchange.ok) throw new CodexAuthError(`OpenAI token exchange failed (${exchange.status})`, false);
  const tokens = (await exchange.json()) as Partial<CodexTokens>;
  if (!tokens.access_token || !tokens.refresh_token) throw new CodexAuthError('OpenAI did not return tokens', false);
  return { access_token: tokens.access_token, refresh_token: tokens.refresh_token };
}

const TERMINAL_CODES = new Set(['invalid_grant', 'invalid_token', 'invalid_request', 'refresh_token_reused']);

/**
 * New tokens from the refresh token. The old refresh token stops working as
 * soon as this succeeds, so the caller must persist the result before using it
 * and must never refresh the same connection twice at once.
 */
export async function refreshTokens(refreshToken: string): Promise<CodexTokens> {
  const res = await post(`${ISSUER}/oauth/token`, { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: CODEX_CLIENT_ID }, true);
  if (res.ok) {
    const json = (await res.json()) as Partial<CodexTokens>;
    if (!json.access_token) throw new CodexAuthError('OpenAI did not return an access token', false);
    return { access_token: json.access_token, refresh_token: json.refresh_token || refreshToken };
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string | { code?: string; type?: string } };
  const code = typeof body.error === 'string' ? body.error : (body.error?.code ?? body.error?.type);
  const relogin = res.status === 401 || res.status === 403 || (code !== undefined && TERMINAL_CODES.has(code));
  throw new CodexAuthError(relogin ? 'The ChatGPT connection expired. Connect it again in Settings.' : `ChatGPT refresh failed (${res.status})`, relogin);
}

interface AuthClaims {
  exp?: number;
  email?: string;
  'https://api.openai.com/auth'?: {
    chatgpt_account_id?: string;
    chatgpt_data_residency?: string;
    chatgpt_compute_residency?: string;
    chatgpt_plan_type?: string;
  };
  'https://api.openai.com/profile'?: { email?: string };
}

/** Claims of the access token (a JWT); no signature check, it is only read for routing headers. */
export function readClaims(accessToken: string): AuthClaims {
  try {
    return JSON.parse(Buffer.from(accessToken.split('.')[1] ?? '', 'base64url').toString('utf8')) as AuthClaims;
  } catch {
    return {};
  }
}

export function accountInfo(accessToken: string): { accountId: string | null; residency: string | null; email: string | null; plan: string | null } {
  const claims = readClaims(accessToken);
  const auth = claims['https://api.openai.com/auth'] ?? {};
  return {
    accountId: auth.chatgpt_account_id ?? null,
    residency: auth.chatgpt_data_residency ?? auth.chatgpt_compute_residency ?? null,
    email: claims['https://api.openai.com/profile']?.email ?? claims.email ?? null,
    plan: auth.chatgpt_plan_type ?? null,
  };
}

export function needsRefresh(accessToken: string, now = Date.now()): boolean {
  const exp = readClaims(accessToken).exp;
  return !exp || exp * 1000 <= now + REFRESH_SKEW_MS;
}
