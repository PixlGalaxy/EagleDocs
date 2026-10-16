import type { EnvConfig } from '../../config/env.js';
import type { Db } from '../../db/pool.js';
import { LOCKS, withAdvisoryLock } from '../../db/tx.js';
import { logger } from '../../logger.js';
import { EMAIL, MIN_PASSWORD_LENGTH, USERNAME } from '../users/users.service.js';
import { hashPassword } from './password.js';

/**
 * Creates the first admin from ADMIN_USERNAME / ADMIN_EMAIL / ADMIN_PASSWORD,
 * only when the database has no admin at all. After that the account is
 * edited in the admin panel and the variables are ignored; they never resync.
 * Runs under an advisory lock so two replicas booting together create one admin.
 */
const WEAK_ADMIN_PASSWORDS = new Set(['change-me-now', 'admin', 'password', 'changeme', 'studyhawk', 'admin123', 'password123']);

export async function bootstrapAdmin(db: Db, config: EnvConfig): Promise<void> {
  await withAdvisoryLock(db, LOCKS.bootstrap, async (client) => {
    const { rows } = await client.query<{ count: number }>("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'");
    if (rows[0]!.count > 0) return;

    const { ADMIN_USERNAME: username, ADMIN_EMAIL: email, ADMIN_PASSWORD: password } = config;
    if (!username || !email || !password) {
      // In development the dev seed already created admin/admin, so this only bites in production.
      if (config.NODE_ENV !== 'production') return;
      throw new Error('No admin account exists yet: set ADMIN_USERNAME, ADMIN_EMAIL and ADMIN_PASSWORD for the first boot.');
    }
    if (!USERNAME.test(username)) throw new Error('ADMIN_USERNAME must be 3-32 letters, digits, dots, dashes or underscores.');
    if (!EMAIL.test(email)) throw new Error('ADMIN_EMAIL is not a valid email address.');
    if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    // The placeholder from .env.example (or anything that short) is public on GitHub. A local production-mode run may keep it.
    const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(config.PUBLIC_URL);
    if (config.NODE_ENV === 'production' && !local && (WEAK_ADMIN_PASSWORDS.has(password.toLowerCase()) || password.length < 12)) {
      throw new Error('ADMIN_PASSWORD is a placeholder or too weak: use at least 12 characters of your own.');
    }

    // Never promote an account that already exists (a student who signed up with ADMIN_EMAIL keeps their own password).
    const created = await client.query(
      `INSERT INTO users (email, username, password_hash, display_name, role, status, language, email_verified_at)
       VALUES ($1, $2, $3, $5, 'admin', 'active', $4, now())
       ON CONFLICT DO NOTHING`,
      [email.toLowerCase(), username, await hashPassword(password), config.LANGUAGE, username],
    );
    if (created.rowCount === 0) {
      throw new Error('ADMIN_EMAIL or ADMIN_USERNAME belongs to an existing account. Use another, or promote that account by hand in the database.');
    }
    logger.warn(`Admin account "${username}" created from the environment. Change its password in Settings.`);
  });
}
