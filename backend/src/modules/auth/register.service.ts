import type pg from 'pg';
import type { EnvConfig } from '../../config/env.js';
import type { Db, Queryable } from '../../db/pool.js';
import { maybe } from '../../db/pool.js';
import { withTx } from '../../db/tx.js';
import type { SettingsService } from '../../db/settings.js';
import { badRequest, conflict, forbidden, tooManyRequests, unavailable } from '../../errors.js';
import { logger } from '../../logger.js';
import { hitRateLimit } from '../../middleware/rate-limit.js';
import { SETTINGS_KEYS } from '../admin/settings-keys.js';
import type { InstitutionsService } from '../institutions/institutions.service.js';
import type { MailService } from '../mail/mail.service.js';
import {
  assertUniqueUser,
  getUserById,
  normalizeEmail,
  optionalText,
  uniqueViolationField,
  validatePassword,
  validateUsername,
  type UserWithInstitution,
} from '../users/users.service.js';
import type { AuthService } from './auth.service.js';
import { hashPassword } from './password.js';
import { hashToken, newCode, newToken } from './tokens.js';

/** Wrong codes allowed before the user has to ask for a new one. */
const MAX_CODE_ATTEMPTS = 5;
const RESET_TTL_MINUTES = 60;
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

const codeHash = (userId: string, code: string) => hashToken(`${userId}:${code}`);

interface VerificationRow {
  user_id: string;
  code_hash: string;
  attempts: number;
  expires_at: Date;
}

/** Sign-up with an allowed university email, verification (link or code), and password reset. */
export class RegisterService {
  constructor(
    private db: Db,
    private config: EnvConfig,
    private settings: SettingsService,
    private institutions: InstitutionsService,
    private mail: MailService,
    private auth: AuthService,
  ) {}

  /**
   * Creates a `pending` account and emails the link and code. Signing up again
   * with an email that is still pending only resends: it never replaces the
   * password, or anyone could plant credentials on someone else's address.
   */
  async register(body: Record<string, unknown>, lang: string): Promise<{ email: string; expires_at: Date }> {
    // In a beta test the admin makes the accounts: nobody signs up on their own.
    if (this.settings.getBoolean(SETTINGS_KEYS.betaTest, false)) throw forbidden('auth.betaClosed');
    if (!this.settings.getBoolean(SETTINGS_KEYS.registrationEnabled, true)) throw forbidden('auth.registrationClosed');
    if (!this.mail.isConfigured()) throw unavailable('auth.registrationUnavailable');

    const email = normalizeEmail(body.email);
    const username = validateUsername(body.username);
    const password = validatePassword(body.password);
    const displayName = optionalText(body.displayName);

    const institution = await this.institutions.matchEmail(this.db, email);
    if (!institution) throw forbidden('auth.domainNotAllowed');

    const existing = await maybe<{ id: string; status: string }>(this.db, 'SELECT id, status FROM users WHERE email = $1', [email]);
    if (existing?.status === 'pending') {
      const expiresAt = await this.sendNewVerification(existing.id, email, lang);
      return { email, expires_at: expiresAt };
    }
    if (existing) throw conflict('users.emailTaken');
    await assertUniqueUser(this.db, 'username', username);

    const passwordHash = await hashPassword(password);
    let created: { userId: string; token: string; code: string; expiresAt: Date };
    try {
      created = await withTx(this.db, async (client) => {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO users (email, username, password_hash, display_name, role, status, institution_id, language)
           VALUES ($1, $2, $3, $4, 'user', 'pending', $5, $6) RETURNING id`,
          [email, username, passwordHash, displayName, institution.id, lang],
        );
        const userId = rows[0]!.id;
        return { userId, ...(await this.issueVerification(client, userId)) };
      });
    } catch (err) {
      const field = uniqueViolationField(err);
      if (field) throw conflict(field === 'email' ? 'users.emailTaken' : 'users.usernameTaken');
      throw err;
    }

    try {
      await this.mail.sendVerification(email, lang, this.verifyLink(created.token), created.code, created.expiresAt);
    } catch (err) {
      // Without the email the account could never be verified: undo it so the person can simply try again.
      await this.db.query('DELETE FROM users WHERE id = $1', [created.userId]);
      throw err;
    }
    logger.auth.info(`Sign-up "${username}" <${email}> (${institution.name}), waiting for verification`);
    return { email, expires_at: created.expiresAt };
  }

  private verifyLink(token: string): string {
    return `${this.config.PUBLIC_URL}/verify?token=${encodeURIComponent(token)}`;
  }

  /**
   * New token and code for the account. The deadline stays tied to when the
   * account was created, so resending never extends the 72 h window.
   */
  private async issueVerification(db: Queryable, userId: string): Promise<{ token: string; code: string; expiresAt: Date }> {
    const token = newToken();
    const code = newCode();
    const { rows } = await db.query<{ expires_at: Date }>(
      `INSERT INTO email_verifications (user_id, token_hash, code_hash, attempts, expires_at)
       SELECT id, $2, $3, 0, created_at + make_interval(secs => $4) FROM users WHERE id = $1
       ON CONFLICT (user_id) DO UPDATE SET token_hash = excluded.token_hash, code_hash = excluded.code_hash,
         attempts = 0, created_at = now()
       RETURNING expires_at`,
      [userId, hashToken(token), codeHash(userId, code), this.config.VERIFICATION_TTL_HOURS * 3600],
    );
    return { token, code, expiresAt: rows[0]!.expires_at };
  }

  private async sendNewVerification(userId: string, email: string, lang: string): Promise<Date> {
    const issued = await this.issueVerification(this.db, userId);
    await this.mail.sendVerification(email, lang, this.verifyLink(issued.token), issued.code, issued.expiresAt);
    return issued.expiresAt;
  }

  /** Always succeeds from the caller's point of view, so it does not reveal which emails signed up. */
  async resend(rawEmail: unknown, ip: string | undefined): Promise<void> {
    const email = normalizeEmail(rawEmail);
    const perMinute = await hitRateLimit(this.db, `resend:min:${email}`, MINUTE, 1);
    const perDay = await hitRateLimit(this.db, `resend:day:${email}`, DAY, 5);
    const perIp = await hitRateLimit(this.db, `resend:ip:${ip}`, DAY, 30);
    for (const hit of [perMinute, perDay, perIp]) if (!hit.allowed) throw tooManyRequests(hit.retryAfterSeconds);

    const user = await maybe<{ id: string; language: string }>(
      this.db,
      "SELECT id, language FROM users WHERE email = $1 AND status = 'pending'",
      [email],
    );
    if (!user) return;
    try {
      await this.sendNewVerification(user.id, email, user.language);
    } catch (err) {
      logger.warn(`Could not resend verification to <${email}>: ${(err as Error).message}`);
    }
  }

  /**
   * By link (`token`) or by `email` + `code`. Activates the account and opens a
   * session, so the person lands signed in.
   */
  async verify(body: Record<string, unknown>, meta: { userAgent?: string; ip?: string }): Promise<{ user: UserWithInstitution; sessionToken: string }> {
    let userId: string;
    if (typeof body.token === 'string' && body.token) {
      const row = await maybe<VerificationRow>(
        this.db,
        'SELECT user_id, code_hash, attempts, expires_at FROM email_verifications WHERE token_hash = $1 AND expires_at > now()',
        [hashToken(body.token)],
      );
      if (!row) throw badRequest('auth.invalidVerification');
      userId = row.user_id;
    } else if (typeof body.email === 'string' && typeof body.code === 'string') {
      const email = normalizeEmail(body.email);
      const code = body.code.replace(/\D/g, '');
      const row = await maybe<VerificationRow>(
        this.db,
        `SELECT v.user_id, v.code_hash, v.attempts, v.expires_at FROM email_verifications v
         JOIN users u ON u.id = v.user_id WHERE u.email = $1 AND u.status = 'pending' AND v.expires_at > now()`,
        [email],
      );
      if (!row) throw badRequest('auth.invalidVerification');
      if (row.attempts >= MAX_CODE_ATTEMPTS) throw badRequest('auth.tooManyAttempts');
      if (code.length !== 6 || codeHash(row.user_id, code) !== row.code_hash) {
        await this.db.query('UPDATE email_verifications SET attempts = attempts + 1 WHERE user_id = $1', [row.user_id]);
        throw badRequest(row.attempts + 1 >= MAX_CODE_ATTEMPTS ? 'auth.tooManyAttempts' : 'auth.invalidVerification');
      }
      userId = row.user_id;
    } else {
      throw badRequest('auth.fieldsRequired');
    }

    const sessionToken = await withTx(this.db, async (client: pg.PoolClient) => {
      const activated = await client.query(
        "UPDATE users SET status = 'active', email_verified_at = now(), updated_at = now() WHERE id = $1 AND status = 'pending'",
        [userId],
      );
      if (activated.rowCount === 0) throw badRequest('auth.invalidVerification');
      await client.query('DELETE FROM email_verifications WHERE user_id = $1', [userId]);
      return this.auth.createSession(client, userId, meta);
    });
    const user = (await getUserById(this.db, userId))!;
    logger.auth.info(`"${user.username}" verified their email`);
    return { user, sessionToken };
  }

  /** Generic response whether or not the email exists. */
  async forgotPassword(rawEmail: unknown, ip: string | undefined): Promise<void> {
    const email = normalizeEmail(rawEmail);
    if (!this.mail.isConfigured()) throw unavailable('mail.notConfigured');
    const perEmail = await hitRateLimit(this.db, `forgot:${email}`, 60 * MINUTE, 3);
    const perIp = await hitRateLimit(this.db, `forgot:ip:${ip}`, 60 * MINUTE, 20);
    for (const hit of [perEmail, perIp]) if (!hit.allowed) throw tooManyRequests(hit.retryAfterSeconds);

    const user = await maybe<{ id: string; language: string }>(
      this.db,
      "SELECT id, language FROM users WHERE email = $1 AND status = 'active'",
      [email],
    );
    if (!user) return;
    const token = newToken();
    await this.db.query('DELETE FROM password_resets WHERE user_id = $1', [user.id]);
    await this.db.query(
      'INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1, $2, now() + make_interval(mins => $3))',
      [user.id, hashToken(token), RESET_TTL_MINUTES],
    );
    try {
      await this.mail.sendPasswordReset(email, user.language, `${this.config.PUBLIC_URL}/reset-password?token=${encodeURIComponent(token)}`);
      logger.auth.info(`Password reset requested for <${email}>`);
    } catch (err) {
      logger.warn(`Could not send password reset to <${email}>: ${(err as Error).message}`);
    }
  }

  async resetPassword(body: Record<string, unknown>): Promise<void> {
    if (typeof body.token !== 'string' || !body.token) throw badRequest('auth.invalidResetToken');
    const newPassword = validatePassword(body.newPassword);
    await withTx(this.db, async (client) => {
      const row = await maybe<{ id: string; user_id: string }>(
        client,
        `SELECT r.id, r.user_id FROM password_resets r JOIN users u ON u.id = r.user_id
         WHERE r.token_hash = $1 AND r.used_at IS NULL AND r.expires_at > now() AND u.status = 'active' FOR UPDATE OF r`,
        [hashToken(body.token as string)],
      );
      if (!row) throw badRequest('auth.invalidResetToken');
      await this.auth.setPassword(client, row.user_id, newPassword);
      await client.query('DELETE FROM password_resets WHERE user_id = $1', [row.user_id]);
      logger.auth.info(`Password reset completed for user ${row.user_id}`);
    });
  }

  /** Leader task: accounts that never verified within the window are deleted. */
  async deleteExpiredPending(): Promise<void> {
    const result = await this.db.query<{ email: string }>(
      `DELETE FROM users WHERE status = 'pending' AND created_at < now() - make_interval(secs => $1) RETURNING email`,
      [this.config.VERIFICATION_TTL_HOURS * 3600],
    );
    for (const row of result.rows) logger.auth.info(`Deleted unverified sign-up <${row.email}>`);
  }
}
