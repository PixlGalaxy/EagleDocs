import { Router, type Response } from 'express';
import type { EnvConfig } from '../../config/env.js';
import type { Db } from '../../db/pool.js';
import { isLanguage } from '../../i18n/index.js';
import { badRequest, forbidden, unauthorized } from '../../errors.js';
import { logger } from '../../logger.js';
import { clearRateLimit, createRateLimiter } from '../../middleware/rate-limit.js';
import { THEME_MODES, THEME_SKINS, type AppRequest } from '../../types/index.js';
import { getUserById, MAX_EMAIL_LENGTH, MAX_PASSWORD_LENGTH, optionalText, toPublicUser, validatePassword } from '../users/users.service.js';
import type { AuthService } from './auth.service.js';
import type { RegisterService } from './register.service.js';
import { requireAuth, SESSION_COOKIE } from './session.middleware.js';

export function createAuthRoutes(
  db: Db,
  config: EnvConfig,
  auth: AuthService,
  register: RegisterService,
  sessionTtlHours: () => number,
): Router {
  const router = Router();

  const setSessionCookie = (res: Response, token: string) =>
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: config.COOKIE_SECURE,
      sameSite: 'lax',
      path: '/',
      maxAge: sessionTtlHours() * 60 * 60 * 1000,
    });

  const loginWindowMs = config.LOGIN_RATE_LIMIT_WINDOW_MINUTES * 60 * 1000;
  const loginAccountKey = (req: AppRequest) => {
    const value = (req.body as { usernameOrEmail?: unknown })?.usernameOrEmail;
    // Over-long values are rejected by the handler; never store them as keys.
    return typeof value === 'string' && value.trim() && value.length <= MAX_EMAIL_LENGTH ? `login:account:${value.trim().toLowerCase()}` : null;
  };
  // Both must pass: caps one IP hammering many accounts, and many IPs hammering one account.
  const loginIpLimiter = createRateLimiter(db, {
    windowMs: loginWindowMs,
    max: config.LOGIN_RATE_LIMIT_MAX,
    keyFn: (req) => `login:ip:${req.ip}`,
    describe: (req) => `login attempts from ${req.ip}`,
  });
  const loginAccountLimiter = createRateLimiter(db, {
    windowMs: loginWindowMs,
    max: config.LOGIN_RATE_LIMIT_MAX,
    keyFn: loginAccountKey,
    describe: (req) => `login attempts against "${(req.body as { usernameOrEmail?: string }).usernameOrEmail}"`,
  });
  const registerLimiter = createRateLimiter(db, {
    windowMs: 60 * 60 * 1000,
    max: 10,
    keyFn: (req) => `register:ip:${req.ip}`,
    describe: (req) => `sign-ups from ${req.ip}`,
  });
  // A stolen session must not be able to guess the current password.
  const changePasswordLimiter = createRateLimiter(db, {
    windowMs: loginWindowMs,
    max: config.LOGIN_RATE_LIMIT_MAX,
    keyFn: (req) => ((req as AppRequest).user ? `change-password:${(req as AppRequest).user!.id}` : null),
    describe: (req) => `password changes by "${(req as AppRequest).user?.username}"`,
  });
  const verifyLimiter = createRateLimiter(db, {
    windowMs: 15 * 60 * 1000,
    max: 30,
    keyFn: (req) => `verify:ip:${req.ip}`,
    describe: (req) => `verification attempts from ${req.ip}`,
  });

  router.post('/login', loginIpLimiter, loginAccountLimiter, async (req: AppRequest, res) => {
    const { usernameOrEmail, password } = req.body as { usernameOrEmail?: unknown; password?: unknown };
    if (typeof usernameOrEmail !== 'string' || typeof password !== 'string' || !usernameOrEmail || !password) {
      throw badRequest('auth.credentialsRequired');
    }
    if (usernameOrEmail.length > MAX_EMAIL_LENGTH) throw unauthorized('auth.invalidCredentials');
    // No account can have a longer password, so skip argon2 and answer like any wrong guess.
    if (password.length > MAX_PASSWORD_LENGTH) throw unauthorized('auth.invalidCredentials');

    const result = await auth.checkCredentials(usernameOrEmail, password);
    if (!result.ok) {
      logger.auth.warn(`Login as "${usernameOrEmail}" from ${req.ip} failed: ${result.reason}`);
      // 403 tells the login page to offer "verify your email"; disabled reads like bad credentials plus a hint.
      if (result.reason === 'pending') throw forbidden('auth.notVerified');
      if (result.reason === 'disabled') throw unauthorized('auth.accountDisabled');
      throw unauthorized('auth.invalidCredentials');
    }

    const token = await auth.createSession(db, result.user.id, { userAgent: req.get('user-agent'), ip: req.ip });
    const accountKey = loginAccountKey(req);
    if (accountKey) await clearRateLimit(db, accountKey);
    logger.auth.info(`Login as "${result.user.username}" from ${req.ip}`);
    setSessionCookie(res, token);
    res.json({ user: toPublicUser(result.user) });
  });

  router.post('/logout', requireAuth, async (req: AppRequest, res) => {
    await auth.logout(req.session!.id);
    logger.auth.info(`Logout as "${req.user!.username}" from ${req.ip}`);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.status(204).end();
  });

  router.get('/me', requireAuth, (req: AppRequest, res) => {
    res.json({ user: toPublicUser(req.user!) });
  });

  router.post('/register', registerLimiter, async (req: AppRequest, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const lang = isLanguage(req.lang) ? req.lang : config.LANGUAGE;
    const result = await register.register(body, lang);
    res.status(201).json(result);
  });

  router.post('/verify', verifyLimiter, async (req: AppRequest, res) => {
    const { user, sessionToken } = await register.verify((req.body ?? {}) as Record<string, unknown>, {
      userAgent: req.get('user-agent'),
      ip: req.ip,
    });
    setSessionCookie(res, sessionToken);
    res.json({ user: toPublicUser(user) });
  });

  router.post('/resend-verification', async (req: AppRequest, res) => {
    await register.resend((req.body as { email?: unknown })?.email, req.ip);
    res.status(204).end();
  });

  router.post('/forgot-password', async (req: AppRequest, res) => {
    await register.forgotPassword((req.body as { email?: unknown })?.email, req.ip);
    res.status(204).end();
  });

  router.post('/reset-password', verifyLimiter, async (req: AppRequest, res) => {
    await register.resetPassword((req.body ?? {}) as Record<string, unknown>);
    res.status(204).end();
  });

  router.post('/change-password', requireAuth, changePasswordLimiter, async (req: AppRequest, res) => {
    const { currentPassword, newPassword } = req.body as { currentPassword?: unknown; newPassword?: unknown };
    if (typeof currentPassword !== 'string' || !currentPassword) throw badRequest('auth.passwordsRequired');
    if (currentPassword.length > MAX_PASSWORD_LENGTH) throw unauthorized('auth.currentPasswordIncorrect');
    const next = validatePassword(newPassword);

    const ok = await auth.changePassword(req.user!.id, currentPassword, next);
    if (!ok) {
      logger.auth.warn(`Password change for "${req.user!.username}" from ${req.ip} failed: wrong current password`);
      throw unauthorized('auth.currentPasswordIncorrect');
    }
    // Every session was closed, this one too: the frontend sends the user back to sign in.
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    logger.auth.info(`Password changed for "${req.user!.username}" from ${req.ip}`);
    res.status(204).end();
  });

  router.patch('/profile', requireAuth, async (req: AppRequest, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const fields: [string, string | null][] = [];
    if ('display_name' in body) fields.push(['display_name', optionalText(body.display_name)]);
    if ('major' in body) fields.push(['major', optionalText(body.major, 120)]);
    if ('timezone' in body) {
      const tz = optionalText(body.timezone, 64);
      if (tz) {
        try {
          new Intl.DateTimeFormat('en', { timeZone: tz });
        } catch {
          throw badRequest('error.invalidInput');
        }
      }
      fields.push(['timezone', tz]);
    }
    if (fields.length > 0) {
      const sets = fields.map(([column], i) => `${column} = $${i + 1}`).join(', ');
      await db.query(`UPDATE users SET ${sets}, updated_at = now() WHERE id = $${fields.length + 1}`, [
        ...fields.map(([, value]) => value),
        req.user!.id,
      ]);
    }
    res.json(toPublicUser((await getUserById(db, req.user!.id))!));
  });

  router.post('/appearance', requireAuth, async (req: AppRequest, res) => {
    const { mode, skin, language, tool_trace: toolTrace, busy_input: busyInput } = req.body as { mode?: unknown; skin?: unknown; language?: unknown; tool_trace?: unknown; busy_input?: unknown };
    if (mode === undefined && skin === undefined && language === undefined && toolTrace === undefined && busyInput === undefined) throw badRequest('auth.invalidTheme');
    if (busyInput !== undefined && !['steer', 'queue', 'interrupt'].includes(busyInput as string)) throw badRequest('auth.invalidTheme');
    if (toolTrace !== undefined && toolTrace !== 'compact' && toolTrace !== 'full') throw badRequest('auth.invalidTheme');
    if (mode !== undefined && !THEME_MODES.includes(mode as never)) throw badRequest('auth.invalidTheme');
    if (skin !== undefined && !THEME_SKINS.includes(skin as never)) throw badRequest('auth.invalidTheme');
    if (language !== undefined && (typeof language !== 'string' || !isLanguage(language))) throw badRequest('auth.invalidLanguage');

    await db.query(
      `UPDATE users SET theme_mode = COALESCE($1, theme_mode), theme_skin = COALESCE($2, theme_skin),
         language = COALESCE($3, language), tool_trace = COALESCE($5, tool_trace),
         busy_input = COALESCE($6, busy_input), updated_at = now() WHERE id = $4`,
      [mode ?? null, skin ?? null, language ?? null, req.user!.id, toolTrace ?? null, busyInput ?? null],
    );
    res.json(toPublicUser((await getUserById(db, req.user!.id))!));
  });

  return router;
}
