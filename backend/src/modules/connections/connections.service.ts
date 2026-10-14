import { randomUUID } from 'crypto';
import type { Secrets } from '../../crypto/secrets.js';
import type { Db } from '../../db/pool.js';
import { many, maybe } from '../../db/pool.js';
import { withTx } from '../../db/tx.js';
import { badRequest, notFound, withDetail } from '../../errors.js';
import { logger } from '../../logger.js';
import { ANTHROPIC_URL, listAnthropicModels } from '../models/providers/anthropic.js';
import {
  accountInfo,
  CodexAuthError,
  CODEX_VERIFY_URL,
  DEVICE_LOGIN_TTL_MS,
  needsRefresh,
  pollDeviceLogin,
  refreshTokens,
  startDeviceLogin,
  type CodexTokens,
} from '../models/providers/codex-auth.js';
import { listCodexModels } from '../models/providers/codex.js';
import { listOpenAIModels } from '../models/providers/openai-compat.js';
import { CanvasClient } from '../canvas/canvas.client.js';

export type ConnectionKind = 'canvas' | 'sso' | 'degreeworks' | 'codex' | 'api_key';

export interface ConnectionRow {
  id: string;
  user_id: string;
  kind: ConnectionKind;
  provider: string | null;
  label: string;
  secret_enc: Buffer | null;
  meta: Record<string, unknown>;
  status: 'ok' | 'error' | 'untested' | 'waiting_mfa';
  last_ok_at: Date | null;
  last_error: string | null;
}

/** API-key providers the Settings page offers, and where their APIs live. */
export const KEY_PROVIDERS: Record<string, { label: string; baseUrl?: string; kind: 'openai_compat' | 'anthropic' }> = {
  openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', kind: 'openai_compat' },
  anthropic: { label: 'Anthropic', baseUrl: ANTHROPIC_URL, kind: 'anthropic' },
  deepseek: { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', kind: 'openai_compat' },
  openrouter: { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', kind: 'openai_compat' },
  google: { label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', kind: 'openai_compat' },
  openai_compat: { label: 'OpenAI-compatible', kind: 'openai_compat' },
};

/** Model ids worth offering from a long provider list (chat models, newest families first). */
function curateModels(provider: string, ids: string[]): string[] {
  const chatLike = ids.filter((id) => !/(embed|whisper|tts|dall-e|image|audio|moderation|transcribe|realtime|search|babbage|davinci)/i.test(id));
  if (provider === 'openrouter') return chatLike.slice(0, 60);
  return chatLike.slice(0, 40);
}

/** What the browser sees: never secrets, meta flattened to strings. */
export function toView(row: ConnectionRow) {
  const meta: Record<string, string> = {};
  for (const [key, value] of Object.entries(row.meta ?? {})) {
    if (key === 'models') meta.models_count = String((value as unknown[]).length);
    else if (value !== null && value !== undefined) meta[key] = String(value);
  }
  return {
    id: row.id,
    kind: row.kind,
    provider: row.provider,
    label: row.label,
    status: row.status,
    last_ok_at: row.last_ok_at,
    last_error: row.last_error,
    meta,
  };
}

export class ConnectionsService {
  constructor(private db: Db, private secrets: Secrets, private appVersion: string) {}

  list(userId: string): Promise<ConnectionRow[]> {
    return many<ConnectionRow>(this.db, 'SELECT * FROM connections WHERE user_id = $1 ORDER BY created_at', [userId]);
  }

  async get(userId: string, id: string): Promise<ConnectionRow> {
    const row = await maybe<ConnectionRow>(this.db, 'SELECT * FROM connections WHERE id = $1 AND user_id = $2', [id, userId]);
    if (!row) throw notFound();
    return row;
  }

  async remove(userId: string, id: string): Promise<void> {
    const result = await this.db.query('DELETE FROM connections WHERE id = $1 AND user_id = $2', [id, userId]);
    if (result.rowCount === 0) throw notFound();
  }

  secretOf(row: ConnectionRow): string {
    if (!row.secret_enc) throw new Error(`Connection ${row.id} has no secret`);
    return this.secrets.decrypt(row.secret_enc);
  }

  /**
   * Canvas, SSO and DegreeWorks exist at most once per user: saving replaces
   * the previous one. `secret` undefined keeps the stored secret.
   */
  async saveSecret(
    userId: string,
    kind: 'canvas' | 'sso' | 'degreeworks',
    input: { label: string; secret?: string; meta: Record<string, unknown>; status: ConnectionRow['status'] },
  ): Promise<ConnectionRow> {
    const existing = await maybe<{ id: string }>(this.db, 'SELECT id FROM connections WHERE user_id = $1 AND kind = $2', [userId, kind]);
    const secret = input.secret === undefined ? undefined : this.secrets.encrypt(input.secret);
    const okAt = input.status === 'ok' ? new Date() : null;
    const { rows } = existing
      ? await this.db.query<ConnectionRow>(
          `UPDATE connections SET label = $2, secret_enc = COALESCE($3, secret_enc), meta = $4, status = $5,
             last_ok_at = COALESCE($6, last_ok_at), last_error = NULL, updated_at = now() WHERE id = $1 RETURNING *`,
          [existing.id, input.label, secret ?? null, input.meta, input.status, okAt],
        )
      : await this.db.query<ConnectionRow>(
          `INSERT INTO connections (user_id, kind, label, secret_enc, meta, status, last_ok_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
          [userId, kind, input.label, secret ?? null, input.meta, input.status, okAt],
        );
    return rows[0]!;
  }

  /** School account (SSO) for Outlook and Degree Works in phase 4. Stored encrypted, tested there. */
  async saveSso(userId: string, body: Record<string, unknown>): Promise<ConnectionRow> {
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const username = typeof body.username === 'string' ? body.username.trim().slice(0, 120) : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password || password.length > 256) throw badRequest('error.invalidInput');
    return this.saveSecret(userId, 'sso', {
      label: 'School account',
      secret: JSON.stringify({ email, username: username || null, password }),
      meta: { email, ...(username && { username }) },
      status: 'untested',
    });
  }

  async setDegreeWorks(userId: string, enabled: boolean): Promise<ConnectionRow> {
    return this.saveSecret(userId, 'degreeworks', { label: 'Degree Works', meta: { enabled: String(enabled) }, status: enabled ? 'untested' : 'ok' });
  }

  // ---------------------------------------------------------------- API keys

  /** Saves a key only after the provider accepted it (listing models), and remembers the models. */
  async addApiKey(userId: string, body: Record<string, unknown>): Promise<ConnectionRow> {
    const provider = typeof body.provider === 'string' ? body.provider : '';
    const spec = KEY_PROVIDERS[provider];
    if (!spec) throw badRequest('error.invalidInput');
    const apiKey = typeof body.api_key === 'string' ? body.api_key.trim() : '';
    if (apiKey.length < 8 || apiKey.length > 500) throw badRequest('error.invalidInput');
    let baseUrl = spec.baseUrl;
    if (provider === 'openai_compat') {
      try {
        const url = new URL(String(body.base_url ?? ''));
        if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('protocol');
        baseUrl = url.toString().replace(/\/+$/, '');
      } catch {
        throw badRequest('error.invalidInput');
      }
    }
    const label = (typeof body.label === 'string' && body.label.trim()) || spec.label;

    let models: string[];
    try {
      models = spec.kind === 'anthropic' ? await listAnthropicModels(apiKey) : await listOpenAIModels(baseUrl!, apiKey);
    } catch (err) {
      throw withDetail(badRequest('models.keyRejected'), (err as Error).message);
    }
    const meta = { key_hint: `...${apiKey.slice(-4)}`, base_url: baseUrl, models: curateModels(provider, models) };
    const { rows } = await this.db.query<ConnectionRow>(
      `INSERT INTO connections (user_id, kind, provider, label, secret_enc, meta, status, last_ok_at)
       VALUES ($1, 'api_key', $2, $3, $4, $5, 'ok', now()) RETURNING *`,
      [userId, provider, label.slice(0, 60), this.secrets.encrypt(apiKey), meta],
    );
    return rows[0]!;
  }

  /** Re-checks a key or ChatGPT connection and refreshes its model list. */
  async test(userId: string, id: string): Promise<ConnectionRow> {
    const row = await this.get(userId, id);
    try {
      if (row.kind === 'api_key') {
        const spec = KEY_PROVIDERS[row.provider ?? ''];
        const key = this.secretOf(row);
        const models =
          spec?.kind === 'anthropic' ? await listAnthropicModels(key) : await listOpenAIModels(String(row.meta.base_url), key);
        await this.markOk(row.id, { ...row.meta, models: curateModels(row.provider ?? '', models) });
      } else if (row.kind === 'canvas') {
        const inst = await maybe<{ canvas_base_url: string | null }>(
          this.db,
          'SELECT i.canvas_base_url FROM users u LEFT JOIN institutions i ON i.id = u.institution_id WHERE u.id = $1',
          [userId],
        );
        const baseUrl = String(row.meta.base_url ?? '') || inst?.canvas_base_url;
        if (!baseUrl) throw new Error('No Canvas address for your school');
        const profile = await new CanvasClient(baseUrl, this.secretOf(row)).profile();
        await this.markOk(row.id, { ...row.meta, name: profile.name ?? null });
      } else if (row.kind === 'codex') {
        const token = await this.codexAccessToken(row.id);
        const models = await listCodexModels(token, this.appVersion);
        await this.markOk(row.id, { ...row.meta, models });
      }
    } catch (err) {
      await this.markError(row.id, (err as Error).message);
    }
    return this.get(userId, id);
  }

  async markOk(id: string, meta?: Record<string, unknown>): Promise<void> {
    await this.db.query(
      `UPDATE connections SET status = 'ok', last_ok_at = now(), last_error = NULL, meta = COALESCE($2, meta), updated_at = now() WHERE id = $1`,
      [id, meta ?? null],
    );
  }

  async markError(id: string, message: string): Promise<void> {
    await this.db.query(`UPDATE connections SET status = 'error', last_error = $2, updated_at = now() WHERE id = $1`, [id, message.slice(0, 500)]);
  }

  // ---------------------------------------------------------------- ChatGPT (Codex)

  /** Starts a device login; the state lives in the DB so any replica can answer the polls. */
  async startCodexLogin(userId: string) {
    const login = await startDeviceLogin();
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + DEVICE_LOGIN_TTL_MS);
    await this.db.query('DELETE FROM codex_device_logins WHERE user_id = $1 OR expires_at < now()', [userId]);
    await this.db.query('INSERT INTO codex_device_logins (id, user_id, state_enc, expires_at) VALUES ($1, $2, $3, $4)', [
      id,
      userId,
      this.secrets.encrypt(JSON.stringify(login)),
      expiresAt,
    ]);
    return {
      verification_uri: CODEX_VERIFY_URL,
      user_code: login.userCode,
      device_auth_id: id,
      interval: login.intervalSeconds,
      expires_at: expiresAt.toISOString(),
    };
  }

  async pollCodexLogin(userId: string, loginId: unknown): Promise<{ status: 'pending' | 'connected' | 'expired'; connection?: ConnectionRow }> {
    const row = await maybe<{ state_enc: Buffer; expires_at: Date }>(
      this.db,
      'SELECT state_enc, expires_at FROM codex_device_logins WHERE id = $1 AND user_id = $2',
      [String(loginId ?? ''), userId],
    );
    if (!row || row.expires_at.getTime() < Date.now()) return { status: 'expired' };
    const state = JSON.parse(this.secrets.decrypt(row.state_enc)) as { deviceAuthId: string; userCode: string };

    let tokens: CodexTokens | null;
    try {
      tokens = await pollDeviceLogin(state.deviceAuthId, state.userCode);
    } catch (err) {
      // Network blips are retried by the browser's next poll.
      if (err instanceof CodexAuthError) throw withDetail(badRequest('models.codexFailed'), err.message);
      logger.warn(`Codex poll failed: ${(err as Error).message}`);
      return { status: 'pending' };
    }
    if (!tokens) return { status: 'pending' };

    await this.db.query('DELETE FROM codex_device_logins WHERE id = $1', [String(loginId)]);
    const info = accountInfo(tokens.access_token);
    const models = await listCodexModels(tokens.access_token, this.appVersion);
    const meta = { email: info.email, plan: info.plan, models };
    // One ChatGPT account per user: reconnecting replaces the old tokens.
    const existing = await maybe<{ id: string }>(this.db, "SELECT id FROM connections WHERE user_id = $1 AND kind = 'codex'", [userId]);
    const secret = this.secrets.encrypt(JSON.stringify(tokens));
    const { rows } = existing
      ? await this.db.query<ConnectionRow>(
          `UPDATE connections SET secret_enc = $2, meta = $3, status = 'ok', last_ok_at = now(), last_error = NULL, updated_at = now()
           WHERE id = $1 RETURNING *`,
          [existing.id, secret, meta],
        )
      : await this.db.query<ConnectionRow>(
          `INSERT INTO connections (user_id, kind, provider, label, secret_enc, meta, status, last_ok_at)
           VALUES ($1, 'codex', 'openai', 'ChatGPT', $2, $3, 'ok', now()) RETURNING *`,
          [userId, secret, meta],
        );
    logger.auth.info(`User ${userId} connected ChatGPT (${info.plan ?? 'unknown plan'})`);
    return { status: 'connected', connection: rows[0]! };
  }

  /**
   * A valid access token for a ChatGPT connection. Refreshing happens under a
   * row lock: refresh tokens are single use, so two replicas refreshing at once
   * would revoke the whole token family.
   */
  async codexAccessToken(connectionId: string): Promise<string> {
    const current = await maybe<ConnectionRow>(this.db, 'SELECT * FROM connections WHERE id = $1', [connectionId]);
    if (!current) throw new Error('ChatGPT connection not found');
    const tokens = JSON.parse(this.secretOf(current)) as CodexTokens;
    if (!needsRefresh(tokens.access_token)) return tokens.access_token;

    try {
      return await withTx(this.db, async (client) => {
        const { rows } = await client.query<ConnectionRow>('SELECT * FROM connections WHERE id = $1 FOR UPDATE', [connectionId]);
        const locked = rows[0];
        if (!locked) throw new Error('ChatGPT connection not found');
        const fresh = JSON.parse(this.secretOf(locked)) as CodexTokens;
        // Another replica may have refreshed while we waited for the lock.
        if (!needsRefresh(fresh.access_token)) return fresh.access_token;
        const next = await refreshTokens(fresh.refresh_token);
        await client.query(
          `UPDATE connections SET secret_enc = $2, status = 'ok', last_ok_at = now(), last_error = NULL, updated_at = now() WHERE id = $1`,
          [connectionId, this.secrets.encrypt(JSON.stringify(next))],
        );
        return next.access_token;
      });
    } catch (err) {
      // Dead refresh token: stop retrying and ask the user to reconnect (outside the rolled-back transaction).
      if (err instanceof CodexAuthError && err.relogin) await this.markError(connectionId, err.message);
      throw err;
    }
  }
}
