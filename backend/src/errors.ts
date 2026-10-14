import type { TranslationKey } from './i18n/index.js';

/** Carries the HTTP status plus the locale key used to render the message. */
export class AppError extends Error {
  status: number;
  key: TranslationKey;
  headers?: Record<string, string>;
  /** Untranslated specifics appended to the message, e.g. what a provider answered. */
  detail?: string;

  constructor(status: number, key: TranslationKey, headers?: Record<string, string>) {
    super(key);
    this.status = status;
    this.key = key;
    this.headers = headers;
  }
}

/** Same as the others, with a provider's own words added. */
export const withDetail = (err: AppError, detail: string) => Object.assign(err, { detail: detail.slice(0, 300) });

export const badRequest = (key: TranslationKey) => new AppError(400, key);
export const unauthorized = (key: TranslationKey = 'auth.notAuthenticated') => new AppError(401, key);
export const forbidden = (key: TranslationKey = 'auth.forbidden') => new AppError(403, key);
export const notFound = (key: TranslationKey = 'error.notFound') => new AppError(404, key);
export const conflict = (key: TranslationKey) => new AppError(409, key);
export const unavailable = (key: TranslationKey) => new AppError(503, key);
export const tooManyRequests = (retryAfterSeconds: number) =>
  new AppError(429, 'error.tooManyRequests', { 'Retry-After': String(retryAfterSeconds) });
