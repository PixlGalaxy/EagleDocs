import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import { hostname } from 'os';
import { isLanguage, type Language } from '../i18n/index.js';
import { logger } from '../logger.js';
import { parseTrustProxy } from './trust-proxy.js';

// src/config/env.ts (or dist/config/env.js) -> repo root
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export interface EnvConfig {
  NODE_ENV: 'development' | 'production';
  PORT: number;
  /** Interface to listen on. Loopback in production: only the bundled nginx should reach the API directly. */
  HOST: string | undefined;
  /** This replica's name in `nodes`, jobs and logs. Defaults to the container hostname. */
  NODE_ID: string;

  DATABASE_URL: string;
  DB_SSL: boolean;
  DB_POOL_MAX: number;

  /** 32 bytes, base64. Encrypts every secret stored in the DB; must be identical on every replica. */
  MASTER_KEY: Buffer;

  /** Only read when no admin exists yet (first boot). */
  ADMIN_USERNAME: string | undefined;
  ADMIN_EMAIL: string | undefined;
  ADMIN_PASSWORD: string | undefined;

  /** Base for links in emails, e.g. https://eagledocs.org (no trailing slash). */
  PUBLIC_URL: string;

  /** Shared storage (NFS/SMB) mounted on every replica. */
  DATA_ROOT: string;
  /** Avatars and other uploads, under DATA_ROOT so every replica serves the same files. */
  ASSETS_DIR: string;
  AVATARS_DIR: string;
  LOCALES_DIR: string;

  SESSION_TTL_HOURS: number;
  COOKIE_SECURE: boolean;
  LOGIN_RATE_LIMIT_MAX: number;
  LOGIN_RATE_LIMIT_WINDOW_MINUTES: number;
  /** How long a sign-up may stay unverified before it is deleted. Lowered in tests. */
  VERIFICATION_TTL_HOURS: number;
  /** Agent jobs this replica runs at the same time. */
  JOB_WORKERS: number;

  /**
   * Per-user sandboxes. `SANDBOX_ENABLED=false` turns code, browser and their tools off.
   * The image default can be changed by the admin (Admin → Sandbox).
   */
  SANDBOX_ENABLED: boolean;
  SANDBOX_IMAGE: string;
  /** Docker network the sandboxes join (created when missing). */
  SANDBOX_NETWORK: string;
  /**
   * Where DATA_ROOT lives for the Docker daemon, which mounts the user's folders into the sandbox:
   * a host path (SANDBOX_DATA_HOST_PATH) or a named volume (SANDBOX_DATA_VOLUME, mounted with a subpath).
   * Without either, DATA_ROOT itself is used (the backend runs on the host, as in development).
   */
  SANDBOX_DATA_HOST_PATH: string | undefined;
  SANDBOX_DATA_VOLUME: string | undefined;
  /** SearXNG base URL for web_search; without it the agent searches through DuckDuckGo's HTML page. */
  SEARXNG_URL: string | undefined;

  LANGUAGE: Language;

  BACKEND_VERSION: string;
  IMAGE_REF: string;
  IMAGE_REVISION?: string;
  /** Proxies allowed to report the client IP in X-Forwarded-For (always includes loopback). See trust-proxy.ts. */
  TRUST_PROXY: string[];
  TRUST_PROXY_SETTING: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required. See .env.example.`);
  return value;
}

function parseMasterKey(raw: string): Buffer {
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('MASTER_KEY must be 32 bytes encoded as base64 (generate one with: openssl rand -base64 32).');
  }
  return key;
}

export function loadEnv(): EnvConfig {
  const env = process.env;
  const isProd = env.NODE_ENV === 'production';

  const DATA_ROOT = resolve(env.DATA_ROOT || (isProd ? '/data' : join(repoRoot, 'data')));
  const ASSETS_DIR = join(DATA_ROOT, 'assets');

  if (env.LANGUAGE && !isLanguage(env.LANGUAGE)) {
    logger.warn(`Unsupported LANGUAGE "${env.LANGUAGE}", falling back to "en"`);
  }

  const trustProxy = parseTrustProxy(env.TRUST_PROXY);
  if (trustProxy.invalid.length > 0) {
    logger.warn(`Ignoring unrecognized TRUST_PROXY entries: ${trustProxy.invalid.join(', ')}`);
  }

  let backendVersion = '0.0.0';
  try {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'backend', 'package.json'), 'utf-8')) as { version?: string };
    if (pkg.version) backendVersion = pkg.version;
  } catch {
    // Best-effort: shown on the admin dashboard, never load-bearing.
  }

  const port = parseInt(env.PORT || '4000', 10);

  return {
    NODE_ENV: isProd ? 'production' : 'development',
    PORT: port,
    // Unset in development so the Vite proxy reaches it whichever of
    // 127.0.0.1 / ::1 "localhost" resolves to on the machine.
    HOST: env.HOST || (isProd ? '127.0.0.1' : undefined),
    NODE_ID: env.NODE_ID || (isProd ? hostname() : `${hostname()}:${port}`),

    DATABASE_URL: required('DATABASE_URL'),
    DB_SSL: env.DB_SSL === 'true',
    DB_POOL_MAX: Math.max(2, parseInt(env.DB_POOL_MAX || '10', 10) || 10),

    MASTER_KEY: parseMasterKey(required('MASTER_KEY')),

    ADMIN_USERNAME: env.ADMIN_USERNAME || undefined,
    ADMIN_EMAIL: env.ADMIN_EMAIL || undefined,
    ADMIN_PASSWORD: env.ADMIN_PASSWORD || undefined,

    PUBLIC_URL: (env.PUBLIC_URL || `http://localhost:${isProd ? 80 : 5173}`).replace(/\/+$/, ''),

    DATA_ROOT,
    ASSETS_DIR,
    AVATARS_DIR: join(ASSETS_DIR, 'avatars'),
    // Shared with the frontend so both render the same strings.
    LOCALES_DIR: resolve(env.LOCALES_DIR || join(repoRoot, 'locales')),

    SESSION_TTL_HOURS: parseInt(env.SESSION_TTL_HOURS || '168', 10),
    // Off by default: behind plain-HTTP nginx a Secure cookie would never be sent back.
    COOKIE_SECURE: env.COOKIE_SECURE === 'true',
    LOGIN_RATE_LIMIT_MAX: parseInt(env.LOGIN_RATE_LIMIT_MAX || '10', 10),
    LOGIN_RATE_LIMIT_WINDOW_MINUTES: parseInt(env.LOGIN_RATE_LIMIT_WINDOW_MINUTES || '15', 10),
    VERIFICATION_TTL_HOURS: Number(env.VERIFICATION_TTL_HOURS || '72') || 72,
    JOB_WORKERS: Math.max(1, parseInt(env.JOB_WORKERS || '4', 10) || 4),

    SANDBOX_ENABLED: env.SANDBOX_ENABLED !== 'false',
    SANDBOX_IMAGE: env.SANDBOX_IMAGE || (isProd ? 'ghcr.io/pixlgalaxy/eagledocs-sandbox:latest' : 'eagledocs-sandbox:dev'),
    SANDBOX_NETWORK: env.SANDBOX_NETWORK || 'eagledocs-sandbox',
    SANDBOX_DATA_HOST_PATH: env.SANDBOX_DATA_HOST_PATH || undefined,
    SANDBOX_DATA_VOLUME: env.SANDBOX_DATA_VOLUME || undefined,
    SEARXNG_URL: env.SEARXNG_URL || undefined,

    LANGUAGE: isLanguage(env.LANGUAGE) ? env.LANGUAGE : 'en',

    BACKEND_VERSION: backendVersion,
    IMAGE_REF: env.APP_IMAGE_REF || 'dev',
    IMAGE_REVISION: env.APP_IMAGE_REVISION || undefined,
    TRUST_PROXY: trustProxy.trusted,
    TRUST_PROXY_SETTING: trustProxy.setting,
  };
}
