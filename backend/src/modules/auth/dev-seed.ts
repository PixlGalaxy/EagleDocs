import type { EnvConfig } from '../../config/env.js';
import type { Db } from '../../db/pool.js';
import { LOCKS, withAdvisoryLock } from '../../db/tx.js';
import { logger } from '../../logger.js';
import { hashPassword } from './password.js';

/** A university for the seeded accounts, so Settings show institution-specific screens. */
const DEV_INSTITUTION = {
  name: 'EagleDocs Dev University',
  slug: 'dev-university',
  domain: 'eagledocs.test',
  canvas: 'https://canvas.instructure.com',
};

const DEV_USERS = [
  { username: 'admin', password: 'admin', email: 'admin@eagledocs.test', role: 'admin', name: 'Dev Admin' },
  { username: 'user', password: 'user', email: 'user@eagledocs.test', role: 'user', name: 'Dev Student' },
] as const;

/**
 * Test accounts for local development only (NODE_ENV is not production).
 * Their passwords and roles are reset on every boot so the credentials always
 * work. They skip the password-length rule on purpose; never in production.
 */
export async function seedDevUsers(db: Db, config: EnvConfig): Promise<void> {
  if (config.NODE_ENV === 'production') return;

  await withAdvisoryLock(db, LOCKS.bootstrap, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO institutions (name, slug, canvas_base_url) VALUES ($1, $2, $3)
       ON CONFLICT (slug) DO UPDATE SET name = excluded.name RETURNING id`,
      [DEV_INSTITUTION.name, DEV_INSTITUTION.slug, DEV_INSTITUTION.canvas],
    );
    const institutionId = rows[0]!.id;
    await client.query(
      `INSERT INTO institution_domains (institution_id, domain, include_subdomains) VALUES ($1, $2, true)
       ON CONFLICT (domain) DO NOTHING`,
      [institutionId, DEV_INSTITUTION.domain],
    );

    for (const user of DEV_USERS) {
      await client.query(
        `INSERT INTO users (email, username, password_hash, display_name, role, status, institution_id, language, email_verified_at)
         VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, now())
         ON CONFLICT (username) DO UPDATE SET password_hash = excluded.password_hash, role = excluded.role,
           status = 'active', updated_at = now()`,
        [user.email, user.username, await hashPassword(user.password), user.name, user.role, institutionId, config.LANGUAGE],
      );
    }
  });

  logger.warn(`Development seed: ${DEV_USERS.map((u) => `${u.username}/${u.password}`).join(', ')} (never in production)`);
}
