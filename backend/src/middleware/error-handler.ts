import type { Request, Response, NextFunction } from 'express';
import type { Translate } from '../i18n/index.js';
import type { AppRequest } from '../types/index.js';
import { AppError } from '../errors.js';
import { logger } from '../logger.js';

const BODY_PARSER_ERRORS = new Set([
  'entity.parse.failed',
  'entity.too.large',
  'entity.verify.failed',
  'encoding.unsupported',
  'charset.unsupported',
  'request.aborted',
  'request.size.invalid',
]);

export function createErrorHandler(t: Translate) {
  return (err: Error, req: Request, res: Response, _next: NextFunction) => {
    const lang = (req as AppRequest).lang;
    if (err instanceof AppError) {
      if (err.headers) {
        for (const [name, value] of Object.entries(err.headers)) res.setHeader(name, value);
      }
      // `code` (the message key) lets the app react to a specific error, e.g. ask for a default model.
      return res.status(err.status).json({ error: err.detail ? `${t(err.key, lang)} (${err.detail})` : t(err.key, lang), code: err.key });
    }

    // express.json() rejections (malformed or oversized body) are the client's
    // fault, not a server crash: answer 400/413 and skip the stack trace.
    const bodyError = err as Error & { type?: unknown; status?: unknown };
    if (typeof bodyError.type === 'string' && BODY_PARSER_ERRORS.has(bodyError.type)) {
      const tooLarge = bodyError.status === 413;
      logger.warn(`Rejected request body: ${bodyError.type}`);
      return res.status(tooLarge ? 413 : 400).json({ error: t(tooLarge ? 'error.payloadTooLarge' : 'error.invalidInput', lang) });
    }

    logger.error(`Unhandled error on ${req.method} ${req.originalUrl}`, err);
    return res.status(500).json({ error: t('error.internal', lang) });
  };
}

export function createNotFoundHandler(t: Translate) {
  return (req: Request, res: Response) => res.status(404).json({ error: t('error.notFound', (req as AppRequest).lang) });
}
