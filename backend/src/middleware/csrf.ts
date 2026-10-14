import { randomBytes, timingSafeEqual } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { forbidden } from '../errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const COOKIE = 'csrf';
const HEADER = 'x-csrf-token';

function sameToken(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Two layers on top of the SameSite=Lax session cookie:
 * 1. `Sec-Fetch-Site`: a state-changing request from another site (or a
 *    sibling subdomain, which Lax does not cover) is refused outright.
 * 2. Double-submit token: the `csrf` cookie is readable by our own pages only,
 *    and the frontend echoes it in `X-CSRF-Token` on every write.
 * `exempt` covers endpoints called by other servers (OAuth token, MCP, webhooks).
 */
export function createCsrfProtection(options: { secure: boolean; exempt?: (req: Request) => boolean }) {
  return (req: Request, res: Response, next: NextFunction) => {
    let token = req.cookies?.[COOKIE] as string | undefined;
    if (!token) {
      token = randomBytes(24).toString('base64url');
      res.cookie(COOKIE, token, { httpOnly: false, secure: options.secure, sameSite: 'lax', path: '/' });
      req.cookies = { ...req.cookies, [COOKIE]: token };
    }

    if (SAFE_METHODS.has(req.method) || options.exempt?.(req)) return next();

    const site = req.get('sec-fetch-site');
    if (site === 'cross-site' || site === 'same-site') return next(forbidden('error.crossSiteRequest'));

    const sent = req.get(HEADER);
    const cookie = req.cookies?.[COOKIE] as string | undefined;
    if (!sent || !cookie || !sameToken(sent, cookie)) return next(forbidden('error.crossSiteRequest'));
    return next();
  };
}
