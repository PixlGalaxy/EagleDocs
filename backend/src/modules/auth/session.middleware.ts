import type { Response, NextFunction } from 'express';
import type { AppRequest } from '../../types/index.js';
import { pickLanguage } from '../../i18n/index.js';
import { forbidden, unauthorized } from '../../errors.js';
import { logger } from '../../logger.js';
import type { AuthService } from './auth.service.js';

export const SESSION_COOKIE = 'session';

/** Resolves `req.user`/`req.session` from the cookie and picks the language for error messages. */
export function createSessionMiddleware(auth: AuthService) {
  return async (req: AppRequest, _res: Response, next: NextFunction) => {
    const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
    if (token) {
      try {
        const result = await auth.getSessionByToken(token);
        if (result) {
          req.user = result.user;
          req.session = result.session;
        }
      } catch (err) {
        logger.error('Session lookup failed', err);
        return next(err);
      }
    }
    req.lang = req.user?.language ?? pickLanguage(req.get('accept-language'));
    return next();
  };
}

export function requireAuth(req: AppRequest, _res: Response, next: NextFunction) {
  if (!req.user || !req.session) return next(unauthorized());
  return next();
}

export function requireAdmin(req: AppRequest, _res: Response, next: NextFunction) {
  if (!req.user || !req.session) return next(unauthorized());
  if (req.user.role !== 'admin') return next(forbidden());
  return next();
}
