import type pg from 'pg';
import type { EnvConfig } from '../../config/env.js';
import type { Db, Queryable } from '../../db/pool.js';
import { maybe } from '../../db/pool.js';
import { withTx } from '../../db/tx.js';
import type { SettingsService } from '../../db/settings.js';
import { badRequest, conflict, forbidden, tooManyRequests, unavailable } from '../../errors.js';
import { logger } from '../../logger.js';
import { hitRateLimit, ipBucket } from '../../middleware/rate-limit.js';
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
import { hashPassword, verifyPassword } from './password.js';
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
   * with an email that is still pending replaces its pending credentials and
   * resends (same limits as "resend"). Verifying asks for the password, so
   * credentials someone else planted on that address can never be activated.
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
      await this.limitResend(email);
      try {
        await this.db.query(
          "UPDATE users SET username = $2, password_hash = $3, display_name = $4, language = $5, updated_at = now() WHERE id = $1 AND status = 'pending'",
          [existing.id, username, await hashPassword(password), displayName, lang],
        );
      } catch (err) {
        if (uniqueViolationField(err)) throw conflict('users.usernameTaken');
        throw err;
      }
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

  /** One new code a minute and five a day per address: each one resets the code's attempts. */
  private async limitResend(email: string): Promise<void> {
    const perMinute = await hitRateLimit(this.db, `resend:min:${email}`, MINUTE, 1);
    const perDay = await hitRateLimit(this.db, `resend:day:${email}`, DAY, 5);
    for (const hit of [perMinute, perDay]) if (!hit.allowed) throw tooManyRequests(hit.retryAfterSeconds);
  }

  /** Always succeeds from the caller's point of view, so it does not reveal which emails signed up. */
  async resend(rawEmail: unknown, ip: string | undefined): Promise<void> {
    const email = normalizeEmail(rawEmail);
    const perIp = await hitRateLimit(this.db, `resend:ip:${ipBucket(ip)}`, DAY, 30);
    if (!perIp.allowed) throw tooManyRequests(perIp.retryAfterSeconds);
    await this.limitResend(email);

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
   * By link (`token`) or by `email` + `code`, plus the account's `password`:
   * the link alone (or a mail scanner opening it) never activates credentials
   * someone else chose. Each try takes one attempt before anything is checked,
   * so parallel guesses cannot go past the limit. Activates the account and
   * opens a session, so the person lands signed in.
   */
  async verify(body: Record<string, unknown>, meta: { userAgent?: string; ip?: string }): Promise<{ user: UserWithInstitution; sessionToken: string }> {
    if (typeof body.password !== 'string' || !body.password) throw badRequest('auth.fieldsRequired');
    let row: VerificationRow | undefined;
    let codeOk = true;
    if (typeof body.token === 'string' && body.token) {
      row = await maybe<VerificationRow>(
        this.db,
        `UPDATE email_verifications SET attempts = attempts + 1
          WHERE token_hash = $1 AND expires_at > now() AND attempts < $2
          RETURNING user_id, code_hash, attempts, expires_at`,
        [hashToken(body.token), MAX_CODE_ATTEMPTS],
      );
      if (!row) throw badRequest('auth.invalidVerification');
    } else if (typeof body.email === 'string' && typeof body.code === 'string') {
      const email = normalizeEmail(body.email);
      const code = body.code.replace(/\D/g, '');
      row = await maybe<VerificationRow>(
        this.db,
        `UPDATE email_verifications v SET attempts = v.attempts + 1
           FROM users u
          WHERE u.id = v.user_id AND u.email = $1 AND u.status = 'pending' AND v.expires_at > now() AND v.attempts < $2
          RETURNING v.user_id, v.code_hash, v.attempts, v.expires_at`,
        [email, MAX_CODE_ATTEMPTS],
      );
      if (!row) throw badRequest('auth.invalidVerification');
      codeOk = code.length === 6 && codeHash(row.user_id, code) === row.code_hash;
    } else {
      throw badRequest('auth.fieldsRequired');
    }
    const userId = row.user_id;
    const account = await maybe<{ password_hash: string }>(this.db, "SELECT password_hash FROM users WHERE id = $1 AND status = 'pending'", [userId]);
    // The password is checked even when the code is wrong, so the timing does not tell which one failed.
    const passwordOk = account ? await verifyPassword(body.password, account.password_hash) : false;
    if (!codeOk || !passwordOk) {
      if (row.attempts >= MAX_CODE_ATTEMPTS) throw badRequest('auth.tooManyAttempts');
      throw badRequest(codeOk ? 'auth.verifyWrongPassword' : 'auth.invalidVerification');
    }

    const sessionToken = await withTx(this.db, async (client: pg.PoolClient) => {
      const activated = await client.query(
        // Only with the password just checked: a sign-up again in between does not get activated.
        "UPDATE users SET status = 'active', email_verified_at = now(), updated_at = now() WHERE id = $1 AND status = 'pending' AND password_hash = $2",
        [userId, account!.password_hash],
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
    const perIp = await hitRateLimit(this.db, `forgot:ip:${ipBucket(ip)}`, 60 * MINUTE, 20);
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
    // Not awaited: the answer takes as long whether or not the account exists.
    void this.mail
      .sendPasswordReset(email, user.language, `${this.config.PUBLIC_URL}/reset-password?token=${encodeURIComponent(token)}`)
      .then(() => logger.auth.info(`Password reset requested for <${email}>`))
      .catch((err: Error) => logger.warn(`Could not send password reset to <${email}>: ${err.message}`));
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
