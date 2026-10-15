import type pg from 'pg';
import type { Db } from '../../db/pool.js';
import { many, maybe } from '../../db/pool.js';
import { withTx } from '../../db/tx.js';
import { badRequest, conflict, forbidden, notFound } from '../../errors.js';
import type { Role, UserStatus } from '../../types/index.js';
import { hashPassword } from '../auth/password.js';
import type { InstitutionsService } from '../institutions/institutions.service.js';
import {
  assertUniqueUser,
  getUserById,
  normalizeEmail,
  optionalText,
  toPublicUser,
  uniqueViolationField,
  USER_SELECT,
  validatePassword,
  validateUsername,
} from '../users/users.service.js';

const ROLES: Role[] = ['admin', 'user'];
const STATUSES: UserStatus[] = ['pending', 'active', 'disabled'];
const UUID = /^[0-9a-f-]{36}$/i;

const ADMIN_ROW_SELECT = `SELECT * FROM (
  ${USER_SELECT.replace('SELECT u.*,', `SELECT u.*,
    (SELECT MAX(s.last_seen_at) FROM sessions s WHERE s.user_id = u.id) AS last_seen_at,
    (SELECT v.expires_at FROM email_verifications v WHERE v.user_id = u.id) AS verification_expires_at,
    -- Admin → Users dot: the agent is running a job or the container is starting (working),
    -- the container is up and waiting (idle), nothing (off).
    CASE
      WHEN EXISTS (SELECT 1 FROM jobs j WHERE j.user_id = u.id AND j.status IN ('running', 'waiting_approval', 'waiting_mfa'))
        OR EXISTS (SELECT 1 FROM sandboxes sb WHERE sb.user_id = u.id AND sb.status = 'starting') THEN 'working'
      WHEN EXISTS (SELECT 1 FROM sandboxes sb WHERE sb.user_id = u.id) THEN 'idle'
      ELSE 'off'
    END AS sandbox_status,`)}
) AS x`;

function uuidOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !UUID.test(value)) throw badRequest('error.invalidInput');
  return value;
}

/** Keeps at least one active admin, checked under a row lock so two admins cannot demote each other at once. */
async function assertOtherActiveAdmin(client: pg.PoolClient, exceptId: string): Promise<void> {
  const { rows } = await client.query<{ id: string }>(
    "SELECT id FROM users WHERE role = 'admin' AND status = 'active' AND id <> $1 FOR UPDATE",
    [exceptId],
  );
  if (rows.length === 0) throw conflict('users.lastAdmin');
}

export class UsersAdminService {
  constructor(private db: Db, private institutions: InstitutionsService) {}

  async list(query: string) {
    const q = query.trim();
    const rows = await many<Record<string, unknown> & Parameters<typeof toPublicUser>[0]>(
      this.db,
      `${ADMIN_ROW_SELECT}
       WHERE $1 = '' OR x.username ILIKE $2 OR x.email ILIKE $2 OR coalesce(x.display_name, '') ILIKE $2
       ORDER BY x.created_at DESC LIMIT 500`,
      [q, `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`],
    );
    return rows.map((row) => toPublicUser(row));
  }

  async get(id: string) {
    const row = await maybe<Parameters<typeof toPublicUser>[0]>(this.db, `${ADMIN_ROW_SELECT} WHERE x.id = $1`, [id]);
    if (!row) throw notFound();
    return toPublicUser(row);
  }

  private async tierOrNull(value: unknown): Promise<string | null> {
    const id = uuidOrNull(value);
    if (id && !(await this.db.query('SELECT 1 FROM tiers WHERE id = $1', [id])).rowCount) throw badRequest('error.invalidInput');
    return id;
  }

  /** Admin-created accounts skip verification. The institution comes from the email domain when there is a match. */
  async create(body: Record<string, unknown>) {
    const email = normalizeEmail(body.email);
    const username = validateUsername(body.username);
    const password = validatePassword(body.password);
    const displayName = optionalText(body.display_name);
    const role = ROLES.includes(body.role as Role) ? (body.role as Role) : 'user';
    const tierId = await this.tierOrNull(body.tier_id);

    await assertUniqueUser(this.db, 'email', email);
    await assertUniqueUser(this.db, 'username', username);
    const institution = await this.institutions.matchEmail(this.db, email);

    try {
      const { rows } = await this.db.query<{ id: string }>(
        `INSERT INTO users (email, username, password_hash, display_name, role, status, institution_id, tier_id, email_verified_at)
         VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, now()) RETURNING id`,
        [email, username, await hashPassword(password), displayName, role, institution?.id ?? null, tierId],
      );
      return this.get(rows[0]!.id);
    } catch (err) {
      const field = uniqueViolationField(err);
      if (field) throw conflict(field === 'email' ? 'users.emailTaken' : 'users.usernameTaken');
      throw err;
    }
  }

  async update(id: string, actorId: string, body: Record<string, unknown>) {
    if (!UUID.test(id)) throw notFound();
    await withTx(this.db, async (client) => {
      const current = await getUserById(client, id);
      if (!current) throw notFound();

      const sets: string[] = [];
      const values: unknown[] = [];
      const set = (column: string, value: unknown) => {
        values.push(value);
        sets.push(`${column} = $${values.length}`);
      };

      if (body.email !== undefined) {
        const email = normalizeEmail(body.email);
        await assertUniqueUser(client, 'email', email, id);
        set('email', email);
      }
      if (body.username !== undefined) {
        const username = validateUsername(body.username);
        await assertUniqueUser(client, 'username', username, id);
        set('username', username);
      }
      if (body.display_name !== undefined) set('display_name', optionalText(body.display_name));
      if (body.institution_id !== undefined) set('institution_id', uuidOrNull(body.institution_id));
      // A plan given by hand, optionally until a date (a scholarship, a trial); then the default plan applies again.
      if (body.tier_id !== undefined) set('tier_id', await this.tierOrNull(body.tier_id));
      if (body.tier_expires_at !== undefined) {
        const until = body.tier_expires_at ? new Date(String(body.tier_expires_at)) : null;
        if (until && Number.isNaN(until.getTime())) throw badRequest('error.invalidInput');
        set('tier_expires_at', until);
      }

      let role = current.role;
      let status = current.status;
      if (body.role !== undefined) {
        if (!ROLES.includes(body.role as Role)) throw badRequest('error.invalidInput');
        role = body.role as Role;
        set('role', role);
      }
      if (body.status !== undefined) {
        if (!STATUSES.includes(body.status as UserStatus)) throw badRequest('error.invalidInput');
        status = body.status as UserStatus;
        set('status', status);
        if (status === 'active' && current.status === 'pending') {
          sets.push('email_verified_at = now()');
          await client.query('DELETE FROM email_verifications WHERE user_id = $1', [id]);
        }
      }

      const losesAdmin = current.role === 'admin' && current.status === 'active' && (role !== 'admin' || status !== 'active');
      if (losesAdmin) await assertOtherActiveAdmin(client, id);
      // Disabling or demoting yourself would lock you out mid-session; ask another admin.
      if (id === actorId && losesAdmin) throw forbidden();

      if (sets.length > 0) {
        try {
          await client.query(`UPDATE users SET ${sets.join(', ')}, updated_at = now() WHERE id = $${values.length + 1}`, [...values, id]);
        } catch (err) {
          const field = uniqueViolationField(err);
          if (field) throw conflict(field === 'email' ? 'users.emailTaken' : 'users.usernameTaken');
          if ((err as { code?: string }).code === '23503') throw badRequest('error.invalidInput');
          throw err;
        }
      }
      // A disabled account loses its sessions right away.
      if (status === 'disabled') await client.query('DELETE FROM sessions WHERE user_id = $1', [id]);
    });
    return this.get(id);
  }

  async resetPassword(id: string, password: unknown): Promise<void> {
    if (!UUID.test(id)) throw notFound();
    const next = validatePassword(password);
    const result = await this.db.query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [await hashPassword(next), id]);
    if (result.rowCount === 0) throw notFound();
    await this.db.query('DELETE FROM sessions WHERE user_id = $1', [id]);
  }

  async delete(id: string, actorId: string): Promise<void> {
    if (!UUID.test(id)) throw notFound();
    if (id === actorId) throw badRequest('users.cannotDeleteSelf');
    await withTx(this.db, async (client) => {
      const current = await getUserById(client, id);
      if (!current) throw notFound();
      if (current.role === 'admin' && current.status === 'active') await assertOtherActiveAdmin(client, id);
      await client.query('DELETE FROM users WHERE id = $1', [id]);
    });
  }
}
