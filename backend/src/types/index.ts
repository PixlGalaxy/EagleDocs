import type { Request } from 'express';

export const THEME_MODES = ['light', 'dark', 'system'] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

/** Accent families from frontend/src/index.css (`data-skin`). */
export const THEME_SKINS = [
  'hawk',
  'eagle',
  'default',
  'ocean',
  'sunset',
  'forest',
  'grape',
  'crimson',
  'solar',
  'arctic',
  'mint',
  'blossom',
  'ares',
  'poseidon',
  'zeus',
  'jade',
  'verdigris',
  'nebula',
  'sakura',
  'slate',
  'mono',
  'graphite',
  'ash',
  'terracotta',
  'olive',
  'maroon',
] as const;
export type ThemeSkin = (typeof THEME_SKINS)[number];

export type Role = 'admin' | 'user';
/** `deleting`: the owner asked to delete it; it is erased after `delete_after` unless they sign in again. */
export type UserStatus = 'pending' | 'active' | 'disabled' | 'deleting';

export interface User {
  id: string;
  email: string;
  username: string;
  password_hash: string;
  display_name: string | null;
  avatar_path: string | null;
  role: Role;
  status: UserStatus;
  institution_id: string | null;
  tier_id: string | null;
  language: string;
  timezone: string | null;
  major: string | null;
  theme_mode: string;
  theme_skin: string;
  /** Tools in the chat: 'compact' (one line) or 'full'. */
  tool_trace: string;
  /** A message typed while the agent works: 'steer', 'queue' or 'interrupt'. */
  busy_input: string;
  email_verified_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/** What the API returns (frontend/src/api/types.ts `User`). */
export interface PublicUser extends Omit<User, 'password_hash' | 'email_verified_at'> {
  institution_name: string | null;
}

export interface Session {
  id: string;
  user_id: string;
  user_agent: string | null;
  ip_address: string | null;
  created_at: Date;
  last_seen_at: Date;
  expires_at: Date;
}

/** Every request after the session middleware. */
export interface AppRequest extends Request {
  user?: User & { institution_name: string | null };
  session?: Session;
  /** Language for error messages: the user's, else Accept-Language, else the server default. */
  lang?: string;
}
