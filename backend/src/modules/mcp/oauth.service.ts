import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import type { Db } from '../../db/pool.js';
import { many, maybe } from '../../db/pool.js';
import { withTx } from '../../db/tx.js';
import { AppError, notFound } from '../../errors.js';

export const MCP_SCOPES = ['canvas.read', 'degreeworks.read', 'workspace', 'memory'] as const;
export type McpScope = (typeof MCP_SCOPES)[number];

const ACCESS_TTL_S = 3600;
const REFRESH_TTL_S = 30 * 86400;
const REQUEST_TTL_MS = 10 * 60_000;

/** An OAuth error with the RFC 6749 code clients understand. */
export class OAuthError extends Error {
  constructor(
    readonly code: 'invalid_request' | 'invalid_client' | 'invalid_grant' | 'unauthorized_client' | 'unsupported_grant_type' | 'invalid_scope' | 'invalid_redirect_uri' | 'invalid_client_metadata' | 'access_denied' | 'unsupported_response_type',
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const token = (prefix: string) => `${prefix}_${randomBytes(32).toString('base64url')}`;

function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Redirect URIs must be https, or http on this machine for local clients (MCP Inspector, desktop apps). */
function validRedirect(uri: string): boolean {
  if (uri.length > 2000) return false;
  try {
    const url = new URL(uri);
    if (url.hash) return false;
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

export function parseScopes(value: unknown): McpScope[] {
  const asked = typeof value === 'string' ? value.split(/\s+/).filter(Boolean) : Array.isArray(value) ? value.map(String) : [];
  // No scope asked: everything, the student narrows it on the consent screen.
  if (asked.length === 0) return [...MCP_SCOPES];
  return MCP_SCOPES.filter((s) => asked.includes(s));
}

interface ClientRow {
  id: string;
  name: string;
  client_uri: string | null;
  redirect_uris: string[];
  secret_hash: string | null;
}

/** What an MCP call is allowed to do, from its access token. */
export interface McpPrincipal {
  grantId: string;
  userId: string;
  clientId: string;
  clientName: string;
  scopes: McpScope[];
}

/**
 * StudyHawk as an OAuth 2.1 authorization server for MCP clients: dynamic
 * client registration, authorization code with PKCE (S256), refresh tokens
 * with rotation, revocation. Tokens are opaque and stored hashed; every check
 * reads the database, so a revocation applies on every replica at once.
 */
export class OAuthService {
  constructor(
    private db: Db,
    private publicUrl: string,
  ) {}

  get issuer(): string {
    return this.publicUrl;
  }

  /** RFC 8414 */
  serverMetadata() {
    const base = this.publicUrl;
    return {
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/oauth/token`,
      registration_endpoint: `${base}/oauth/register`,
      revocation_endpoint: `${base}/oauth/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
      scopes_supported: [...MCP_SCOPES],
      authorization_response_iss_parameter_supported: true,
    };
  }

  /** RFC 9728 */
  resourceMetadata() {
    return {
      resource: `${this.publicUrl}/mcp`,
      authorization_servers: [this.publicUrl],
      scopes_supported: [...MCP_SCOPES],
      bearer_methods_supported: ['header'],
      resource_name: 'StudyHawk',
    };
  }

  /** RFC 7591 dynamic client registration. */
  async register(body: Record<string, unknown>) {
    const redirects = Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String) : [];
    if (redirects.length === 0 || redirects.length > 10 || !redirects.every(validRedirect)) {
      throw new OAuthError('invalid_redirect_uri', 'redirect_uris must be https URLs (or http on localhost)');
    }
    const name = (typeof body.client_name === 'string' ? body.client_name.trim() : '').slice(0, 100) || 'MCP client';
    const clientUri = typeof body.client_uri === 'string' && /^https:\/\//.test(body.client_uri) ? body.client_uri.slice(0, 300) : null;
    const method = typeof body.token_endpoint_auth_method === 'string' ? body.token_endpoint_auth_method : 'none';
    if (!['none', 'client_secret_post', 'client_secret_basic'].includes(method)) {
      throw new OAuthError('invalid_client_metadata', 'token_endpoint_auth_method must be none, client_secret_post or client_secret_basic');
    }
    const id = `mcp_${randomBytes(12).toString('base64url')}`;
    const secret = method === 'none' ? null : token('mcs');
    await this.db.query('INSERT INTO oauth_clients (id, name, client_uri, redirect_uris, secret_hash) VALUES ($1, $2, $3, $4, $5)', [
      id,
      name,
      clientUri,
      redirects,
      secret ? sha256(secret) : null,
    ]);
    return {
      client_id: id,
      ...(secret && { client_secret: secret, client_secret_expires_at: 0 }),
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: name,
      redirect_uris: redirects,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: method,
    };
  }

  private client(id: string) {
    return maybe<ClientRow>(this.db, 'SELECT * FROM oauth_clients WHERE id = $1', [id]);
  }

  /**
   * GET /oauth/authorize. Until the redirect URI is known to be the client's,
   * errors are shown here (never redirected); after that they go back to it.
   */
  async authorize(q: Record<string, unknown>): Promise<{ consent: string } | { redirect: string }> {
    const clientId = String(q.client_id ?? '');
    const redirectUri = String(q.redirect_uri ?? '');
    const client = clientId ? await this.client(clientId) : undefined;
    if (!client) throw new OAuthError('invalid_client', 'Unknown client_id');
    if (!client.redirect_uris.includes(redirectUri)) throw new OAuthError('invalid_redirect_uri', 'redirect_uri is not registered for this client');
    // Errors before consent show our page instead of redirecting: anyone can register a client, so redirecting
    // from here would turn this URL into an open redirect (RFC 9700 4.11.2).
    const back = (error: OAuthError['code'], description: string): never => {
      throw new OAuthError(error, description);
    };
    if (q.response_type !== 'code') return back('unsupported_response_type', 'Only response_type=code');
    const challenge = String(q.code_challenge ?? '');
    if (q.code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43,128}$/.test(challenge)) return back('invalid_request', 'PKCE with S256 is required');
    const scopes = parseScopes(q.scope);
    if (scopes.length === 0) return back('invalid_scope', `Known scopes: ${MCP_SCOPES.join(' ')}`);
    const id = randomBytes(18).toString('base64url');
    await this.db.query(
      `INSERT INTO oauth_requests (id, client_id, redirect_uri, code_challenge, scopes, state, resource, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, client.id, redirectUri, challenge, scopes, typeof q.state === 'string' ? q.state.slice(0, 500) : null, typeof q.resource === 'string' ? q.resource.slice(0, 300) : null, new Date(Date.now() + REQUEST_TTL_MS)],
    );
    return { consent: `${this.publicUrl}/oauth/consent?request=${encodeURIComponent(id)}` };
  }

  private withParams(uri: string, params: Record<string, unknown>): string {
    const url = new URL(uri);
    for (const [k, v] of Object.entries(params)) if (typeof v === 'string' && v) url.searchParams.set(k, v);
    return url.toString();
  }

  private async pending(requestId: string) {
    const row = await maybe<{ id: string; client_id: string; redirect_uri: string; scopes: string[]; state: string | null; name: string; client_uri: string | null }>(
      this.db,
      `SELECT r.id, r.client_id, r.redirect_uri, r.scopes, r.state, c.name, c.client_uri
         FROM oauth_requests r JOIN oauth_clients c ON c.id = r.client_id
        WHERE r.id = $1 AND r.expires_at > now() AND r.code_hash IS NULL AND r.used_at IS NULL`,
      [requestId],
    );
    if (!row) throw notFound();
    return row;
  }

  /** The consent screen (frontend /oauth/consent). */
  async consent(requestId: string) {
    const r = await this.pending(requestId);
    return { request_id: r.id, client_name: r.name, client_uri: r.client_uri, redirect_uri: r.redirect_uri, scopes: r.scopes };
  }

  /** The student approved (some scopes) or refused. Returns where to send the browser. */
  async decide(userId: string, requestId: string, approve: boolean, scopes: unknown): Promise<{ redirect_to: string }> {
    const r = await this.pending(requestId);
    if (!approve) {
      await this.db.query('UPDATE oauth_requests SET used_at = now() WHERE id = $1 AND code_hash IS NULL', [r.id]);
      return { redirect_to: this.withParams(r.redirect_uri, { error: 'access_denied', state: r.state, iss: this.issuer }) };
    }
    const granted = parseScopes(scopes).filter((s) => r.scopes.includes(s));
    if (granted.length === 0) throw new AppError(400, 'error.invalidInput');
    const code = token('mcc');
    // Once: two approvals at the same time (or one after a refusal) must not both get a code.
    const decided = await this.db.query(
      'UPDATE oauth_requests SET user_id = $2, code_hash = $3, granted_scopes = $4, expires_at = $5 WHERE id = $1 AND code_hash IS NULL AND used_at IS NULL',
      [r.id, userId, sha256(code), granted, new Date(Date.now() + REQUEST_TTL_MS)],
    );
    if (!decided.rowCount) throw new AppError(400, 'error.invalidInput');
    return { redirect_to: this.withParams(r.redirect_uri, { code, state: r.state, iss: this.issuer }) };
  }

  /** Client authentication at the token endpoint: public clients send only client_id, confidential ones their secret. */
  private async authenticate(body: Record<string, unknown>, authorization: string | undefined): Promise<ClientRow> {
    let id = typeof body.client_id === 'string' ? body.client_id : '';
    let secret = typeof body.client_secret === 'string' ? body.client_secret : '';
    if (authorization?.startsWith('Basic ')) {
      const [user, pass] = Buffer.from(authorization.slice(6), 'base64').toString('utf8').split(':');
      try {
        id = decodeURIComponent(user ?? '');
        secret = decodeURIComponent(pass ?? '');
      } catch {
        throw new OAuthError('invalid_client', 'Malformed client credentials', 401);
      }
    }
    const client = id ? await this.client(id) : undefined;
    if (!client) throw new OAuthError('invalid_client', 'Unknown client', 401);
    if (client.secret_hash && !(secret && sameHash(sha256(secret), client.secret_hash))) throw new OAuthError('invalid_client', 'Wrong client secret', 401);
    return client;
  }

  private async issue(grantId: string, scopes: string[]) {
    const access = token('mca');
    const refresh = token('mcr');
    await this.db.query(
      `INSERT INTO oauth_tokens (token_hash, grant_id, kind, expires_at) VALUES ($1, $3, 'access', $4), ($2, $3, 'refresh', $5)`,
      [sha256(access), sha256(refresh), grantId, new Date(Date.now() + ACCESS_TTL_S * 1000), new Date(Date.now() + REFRESH_TTL_S * 1000)],
    );
    return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: scopes.join(' ') };
  }

  /** POST /oauth/token */
  async token(body: Record<string, unknown>, authorization: string | undefined) {
    const client = await this.authenticate(body, authorization);
    if (body.grant_type === 'authorization_code') {
      const code = String(body.code ?? '');
      const verifier = String(body.code_verifier ?? '');
      return withTx(this.db, async (tx) => {
        const r = await tx.query<{ id: string; client_id: string; redirect_uri: string; code_challenge: string; user_id: string; granted_scopes: string[]; used_at: Date | null; expires_at: Date }>(
          'SELECT * FROM oauth_requests WHERE code_hash = $1 FOR UPDATE',
          [sha256(code)],
        );
        const req = r.rows[0];
        if (req?.used_at && req.client_id === client.id) {
          // A code used twice: someone else has a copy, so what it gave out is cut (RFC 6749 4.1.2).
          await tx.query(
            "UPDATE oauth_tokens SET revoked_at = now() WHERE revoked_at IS NULL AND grant_id IN (SELECT id FROM oauth_grants WHERE user_id = $1 AND client_id = $2)",
            [req.user_id, client.id],
          );
        }
        if (!req || req.used_at || req.expires_at < new Date() || req.client_id !== client.id) throw new OAuthError('invalid_grant', 'The code is invalid, expired or already used');
        // Required, and exactly the one the code was issued for (RFC 6749 4.1.3).
        if (body.redirect_uri !== req.redirect_uri) throw new OAuthError('invalid_grant', 'redirect_uri does not match');
        const expected = createHash('sha256').update(verifier).digest('base64url');
        if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || !sameHash(expected, req.code_challenge)) throw new OAuthError('invalid_grant', 'PKCE verification failed');
        await tx.query('UPDATE oauth_requests SET used_at = now() WHERE id = $1', [req.id]);
        // One grant per student and client: authorizing again updates it.
        const existing = await tx.query<{ id: string }>(
          'SELECT id FROM oauth_grants WHERE user_id = $1 AND client_id = $2 AND revoked_at IS NULL LIMIT 1',
          [req.user_id, client.id],
        );
        let grantId = existing.rows[0]?.id;
        if (grantId) await tx.query('UPDATE oauth_grants SET scopes = $2 WHERE id = $1', [grantId, req.granted_scopes]);
        else {
          grantId = (await tx.query<{ id: string }>('INSERT INTO oauth_grants (user_id, client_id, scopes) VALUES ($1, $2, $3) RETURNING id', [req.user_id, client.id, req.granted_scopes])).rows[0]!.id;
        }
        const access = token('mca');
        const refresh = token('mcr');
        await tx.query(
          `INSERT INTO oauth_tokens (token_hash, grant_id, kind, expires_at) VALUES ($1, $3, 'access', $4), ($2, $3, 'refresh', $5)`,
          [sha256(access), sha256(refresh), grantId, new Date(Date.now() + ACCESS_TTL_S * 1000), new Date(Date.now() + REFRESH_TTL_S * 1000)],
        );
        return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: req.granted_scopes.join(' ') };
      });
    }
    if (body.grant_type === 'refresh_token') {
      const hash = sha256(String(body.refresh_token ?? ''));
      const row = await maybe<{ grant_id: string; expires_at: Date; revoked_at: Date | null; client_id: string; scopes: string[]; grant_revoked: Date | null; user_status: string }>(
        this.db,
        `SELECT t.grant_id, t.expires_at, t.revoked_at, g.client_id, g.scopes, g.revoked_at AS grant_revoked, u.status AS user_status
           FROM oauth_tokens t JOIN oauth_grants g ON g.id = t.grant_id JOIN users u ON u.id = g.user_id
          WHERE t.token_hash = $1 AND t.kind = 'refresh'`,
        [hash],
      );
      // A disabled (or deleting) account gets no new tokens, even with a valid refresh token.
      if (!row || row.client_id !== client.id || row.grant_revoked || row.expires_at < new Date() || row.user_status !== 'active') {
        throw new OAuthError('invalid_grant', 'The refresh token is invalid');
      }
      if (row.revoked_at) {
        // A rotated refresh token used again: someone has a copy. Cut the whole grant.
        await this.revokeGrantTokens(row.grant_id);
        throw new OAuthError('invalid_grant', 'The refresh token was already used');
      }
      const rotated = await this.db.query('UPDATE oauth_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [hash]);
      if (!rotated.rowCount) throw new OAuthError('invalid_grant', 'The refresh token was already used');
      return this.issue(row.grant_id, row.scopes);
    }
    throw new OAuthError('unsupported_grant_type', 'Use authorization_code or refresh_token');
  }

  /** RFC 7009: always succeeds, whatever the token was. */
  async revokeToken(value: string): Promise<void> {
    await this.db.query('UPDATE oauth_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [sha256(value)]);
  }

  private async revokeGrantTokens(grantId: string): Promise<void> {
    await this.db.query('UPDATE oauth_tokens SET revoked_at = now() WHERE grant_id = $1 AND revoked_at IS NULL', [grantId]);
  }

  /** The principal behind an access token, or null when it is unknown, expired or revoked. */
  async verify(accessToken: string): Promise<McpPrincipal | null> {
    if (!/^mca_[A-Za-z0-9_-]{20,}$/.test(accessToken)) return null;
    const row = await maybe<{ grant_id: string; user_id: string; client_id: string; name: string; scopes: McpScope[]; last_used_at: Date | null }>(
      this.db,
      `SELECT g.id AS grant_id, g.user_id, g.client_id, c.name, g.scopes, g.last_used_at
         FROM oauth_tokens t JOIN oauth_grants g ON g.id = t.grant_id JOIN oauth_clients c ON c.id = g.client_id
         JOIN users u ON u.id = g.user_id
        WHERE t.token_hash = $1 AND t.kind = 'access' AND t.revoked_at IS NULL AND t.expires_at > now()
          AND g.revoked_at IS NULL AND u.status = 'active'`,
      [sha256(accessToken)],
    );
    if (!row) return null;
    if (!row.last_used_at || Date.now() - row.last_used_at.getTime() > 60_000) {
      void this.db.query('UPDATE oauth_grants SET last_used_at = now() WHERE id = $1', [row.grant_id]).catch(() => undefined);
    }
    return { grantId: row.grant_id, userId: row.user_id, clientId: row.client_id, clientName: row.name, scopes: row.scopes };
  }

  /** Settings → Apps. */
  apps(userId: string) {
    return many(
      this.db,
      `SELECT g.id, c.name AS client_name, c.client_uri, g.scopes, g.created_at, g.last_used_at
         FROM oauth_grants g JOIN oauth_clients c ON c.id = g.client_id
        WHERE g.user_id = $1 AND g.revoked_at IS NULL ORDER BY g.created_at DESC`,
      [userId],
    );
  }

  async revokeGrant(userId: string, grantId: string): Promise<void> {
    if (!/^[0-9a-f-]{36}$/i.test(grantId)) throw notFound();
    const result = await this.db.query('UPDATE oauth_grants SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL', [grantId, userId]);
    if (!result.rowCount) throw notFound();
    await this.revokeGrantTokens(grantId);
  }
}
