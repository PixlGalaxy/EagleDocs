import { randomBytes } from 'crypto';
import type { Db, Queryable } from '../../db/pool.js';
import { maybe } from '../../db/pool.js';
import type { Session } from '../../types/index.js';
import { getUserByLogin, getUserById, type UserWithInstitution } from '../users/users.service.js';
import { hashPassword, verifyPassword } from './password.js';
import { hashToken, newToken } from './tokens.js';

/**
 * Verified against when no account matches, so a miss costs the same argon2
 * work as a wrong password and response time does not reveal which accounts exist.
 */
let dummyHash: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  return dummyHash;
}

/** Only refresh `last_seen_at` this often, so every request is not a write. */
const LAST_SEEN_RESOLUTION_MS = 5 * 60 * 1000;

export type LoginResult =
  | { ok: true; user: UserWithInstitution }
  | { ok: false; reason: 'invalid' | 'pending' | 'disabled' };

export class AuthService {
  constructor(private db: Db, private sessionTtlHours: () => number) {}

  async checkCredentials(usernameOrEmail: string, password: string): Promise<LoginResult> {
    const user = await getUserByLogin(this.db, usernameOrEmail.trim());
    if (!user) {
      await verifyPassword(password, await getDummyHash());
      return { ok: false, reason: 'invalid' };
    }
    if (!(await verifyPassword(password, user.password_hash))) return { ok: false, reason: 'invalid' };
    // Only after the password matched, so these do not reveal that an account exists.
    if (user.status === 'pending') return { ok: false, reason: 'pending' };
    if (user.status === 'disabled') return { ok: false, reason: 'disabled' };
    return { ok: true, user };
  }

  /** Returns the cookie token; only its hash is stored. */
  async createSession(db: Queryable, userId: string, meta: { userAgent?: string; ip?: string }): Promise<string> {
    const token = newToken();
    await db.query(
      `INSERT INTO sessions (id, user_id, user_agent, ip_address, expires_at)
       VALUES ($1, $2, $3, $4, now() + make_interval(hours => $5))`,
      [hashToken(token), userId, meta.userAgent?.slice(0, 500) ?? null, meta.ip ?? null, this.sessionTtlHours()],
    );
    return token;
  }

  async getSessionByToken(token: string): Promise<{ user: UserWithInstitution; session: Session } | null> {
    const session = await maybe<Session>(this.db, 'SELECT * FROM sessions WHERE id = $1 AND expires_at > now()', [
      hashToken(token),
    ]);
    if (!session) return null;

    const user = await getUserById(this.db, session.user_id);
    if (!user || user.status !== 'active') return null;

    if (Date.now() - new Date(session.last_seen_at).getTime() > LAST_SEEN_RESOLUTION_MS) {
      await this.db.query('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [session.id]);
    }
    return { user, session };
  }

  async logout(sessionId: string): Promise<void> {
    await this.db.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
  }

  /** Expired rows are useless but would otherwise accumulate forever. */
  async pruneExpired(): Promise<void> {
    await this.db.query('DELETE FROM sessions WHERE expires_at <= now()');
    await this.db.query('DELETE FROM password_resets WHERE expires_at <= now() - interval \'1 day\'');
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<boolean> {
    const user = await maybe<{ password_hash: string }>(this.db, 'SELECT password_hash FROM users WHERE id = $1', [userId]);
    if (!user || !(await verifyPassword(currentPassword, user.password_hash))) return false;
    await this.setPassword(this.db, userId, newPassword);
    return true;
  }

  /** Also signs the user out everywhere. */
  async setPassword(db: Queryable, userId: string, newPassword: string): Promise<void> {
    const hash = await hashPassword(newPassword);
    await db.query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [hash, userId]);
    await db.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
  }
}
