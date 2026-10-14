import type { Queryable } from '../../db/pool.js';
import { maybe } from '../../db/pool.js';
import { badRequest, conflict } from '../../errors.js';
import type { PublicUser, User } from '../../types/index.js';

export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const USERNAME = /^[a-zA-Z0-9._-]{3,32}$/;
export const MIN_PASSWORD_LENGTH = 8;
// argon2 accepts any length, so cap it: a multi-megabyte "password" would
// otherwise be hashed in full on every login attempt.
export const MAX_PASSWORD_LENGTH = 256;
export const MAX_NAME_LENGTH = 80;

export type UserWithInstitution = User & { institution_name: string | null };

/** Selects users with their institution's name, as the API returns them. */
export const USER_SELECT = `SELECT u.*, i.name AS institution_name FROM users u LEFT JOIN institutions i ON i.id = u.institution_id`;

export function toPublicUser(user: UserWithInstitution): PublicUser {
  const { password_hash: _hash, email_verified_at: _verified, ...rest } = user;
  return rest;
}

export function getUserById(db: Queryable, id: string): Promise<UserWithInstitution | undefined> {
  return maybe<UserWithInstitution>(db, `${USER_SELECT} WHERE u.id = $1`, [id]);
}

/** Login accepts either; both columns are citext, so this is case-insensitive. */
export function getUserByLogin(db: Queryable, usernameOrEmail: string): Promise<UserWithInstitution | undefined> {
  return maybe<UserWithInstitution>(db, `${USER_SELECT} WHERE u.email = $1 OR u.username = $1 LIMIT 1`, [usernameOrEmail]);
}

export function normalizeEmail(value: unknown): string {
  if (typeof value !== 'string' || !EMAIL.test(value.trim())) throw badRequest('users.invalidEmail');
  return value.trim().toLowerCase();
}

export function validateUsername(value: unknown): string {
  if (typeof value !== 'string' || !USERNAME.test(value.trim())) throw badRequest('users.invalidUsername');
  return value.trim();
}

export function validatePassword(value: unknown): string {
  if (typeof value !== 'string' || !value) throw badRequest('auth.passwordsRequired');
  if (value.length < MIN_PASSWORD_LENGTH) throw badRequest('auth.passwordTooShort');
  if (value.length > MAX_PASSWORD_LENGTH) throw badRequest('auth.passwordTooLong');
  return value;
}

/** Trimmed optional text; empty becomes null. */
export function optionalText(value: unknown, max = MAX_NAME_LENGTH): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || value.length > max) throw badRequest('error.invalidInput');
  return value.trim() || null;
}

export async function assertUniqueUser(db: Queryable, field: 'email' | 'username', value: string, exceptId?: string): Promise<void> {
  const row = await maybe<{ id: string }>(
    db,
    `SELECT id FROM users WHERE ${field} = $1 AND ($2::uuid IS NULL OR id <> $2::uuid)`,
    [value, exceptId ?? null],
  );
  if (row) throw conflict(field === 'email' ? 'users.emailTaken' : 'users.usernameTaken');
}

/** Postgres unique violations raced past assertUniqueUser. */
export function uniqueViolationField(err: unknown): 'email' | 'username' | null {
  const pgErr = err as { code?: string; constraint?: string };
  if (pgErr.code !== '23505') return null;
  if (pgErr.constraint?.includes('email')) return 'email';
  if (pgErr.constraint?.includes('username')) return 'username';
  return null;
}
