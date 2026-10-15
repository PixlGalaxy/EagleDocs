import express, { Router, type NextFunction, type Request, type Response } from 'express';
import type { Db } from '../../db/pool.js';
import type { SettingsService } from '../../db/settings.js';
import { createRateLimiter, hitRateLimit } from '../../middleware/rate-limit.js';
import { logger } from '../../logger.js';
import { routeParam } from '../../route-params.js';
import type { AppRequest } from '../../types/index.js';
import { requireAuth } from '../auth/session.middleware.js';
import { SETTINGS_KEYS as K } from '../admin/settings-keys.js';
import type { McpServer } from './mcp.server.js';
import { OAuthError, type OAuthService } from './oauth.service.js';

/** MCP clients may run in a browser (MCP Inspector): bearer tokens, not cookies, so any origin is fine. */
function cors(req: Request, res: Response, next: NextFunction) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, MCP-Protocol-Version, Mcp-Session-Id');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Expose-Headers', 'WWW-Authenticate, Mcp-Session-Id');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
}

const oauthJson = (res: Response, err: unknown) => {
  if (err instanceof OAuthError) {
    res.status(err.status).json({ error: err.code, error_description: err.message });
    return;
  }
  throw err;
};

/** A plain page for authorize errors that cannot go back to the client (unknown client or redirect URI). */
const errorPage = (message: string) =>
  `<!doctype html><meta charset="utf-8"><title>EagleDocs</title><body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem">` +
  `<h1>This app could not connect</h1><p>${message.replace(/[<>&"]/g, '')}</p><p>Go back to the app and try adding EagleDocs again.</p></body>`;

/**
 * Public OAuth and MCP endpoints (no session, no CSRF: clients use tokens),
 * and the signed-in parts: the consent screen and Settings → Apps.
 */
/** JSON-RPC messages per POST: batches were dropped from MCP, so clients send one; a few is plenty. */
const MAX_BATCH = 10;
/** Every POST to /mcp counts (tools/list too), apart from the per-call tool limit. */
const REQUESTS_PER_MINUTE = 240;

export function createMcpRoutes(deps: { db: Db; oauth: OAuthService; server: McpServer; settings: SettingsService }) {
  const { db, oauth, server, settings } = deps;
  // Public endpoints, so by address: registrations write rows, authorize writes a pending request.
  const perIp = (name: string, windowMs: number, max: number) =>
    createRateLimiter(db, { windowMs, max, keyFn: (req) => `oauth:${name}:${req.ip}`, describe: (req) => `OAuth ${name} from ${req.ip}` });
  const enabled = () => settings.getBoolean(K.mcpEnabled, false);
  const open = Router();
  /** Mounted at /api/oauth and /api/mcp-apps only: requireAuth must not reach other /api routes. */
  const consent = Router();
  const apps = Router();

  open.use(['/.well-known', '/oauth/register', '/oauth/token', '/oauth/revoke', '/mcp'], cors);
  open.use(['/oauth/token', '/oauth/revoke'], express.urlencoded({ extended: false, limit: '64kb' }));

  // Discovery (RFC 9728 and 8414); the resource path variant is what some clients ask for.
  open.get(['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'], (_req, res) => {
    if (!enabled()) return void res.status(404).end();
    res.json(oauth.resourceMetadata());
  });
  open.get(['/.well-known/oauth-authorization-server', '/.well-known/oauth-authorization-server/mcp', '/.well-known/openid-configuration'], (_req, res) => {
    if (!enabled()) return void res.status(404).end();
    res.json(oauth.serverMetadata());
  });

  open.post('/oauth/register', perIp('register', 60 * 60_000, 20), async (req, res) => {
    if (!enabled()) return void res.status(404).end();
    try {
      res.status(201).json(await oauth.register((req.body ?? {}) as Record<string, unknown>));
    } catch (err) {
      oauthJson(res, err);
    }
  });

  open.get('/oauth/authorize', perIp('authorize', 60_000, 60), async (req, res) => {
    if (!enabled()) return void res.status(404).type('html').send(errorPage('EagleDocs apps are turned off on this server.'));
    try {
      const next = await oauth.authorize(req.query as Record<string, unknown>);
      res.redirect(302, 'consent' in next ? next.consent : next.redirect);
    } catch (err) {
      if (err instanceof OAuthError) return void res.status(400).type('html').send(errorPage(err.message));
      throw err;
    }
  });

  open.post('/oauth/token', perIp('token', 60_000, 60), async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      res.json(await oauth.token((req.body ?? {}) as Record<string, unknown>, req.get('authorization')));
    } catch (err) {
      oauthJson(res, err);
    }
  });

  open.post('/oauth/revoke', perIp('revoke', 60_000, 60), async (req, res) => {
    const token = (req.body as { token?: unknown })?.token;
    if (typeof token === 'string') await oauth.revokeToken(token);
    res.status(200).end();
  });

  // ---------------------------------------------------------------- the MCP endpoint (Streamable HTTP, stateless)
  const challenge = () => `Bearer resource_metadata="${oauth.issuer}/.well-known/oauth-protected-resource", error="invalid_token"`;
  open.all('/mcp', async (req, res) => {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return void res.status(405).json({ error: 'Use POST' });
    }
    if (!enabled()) return void res.status(404).json({ error: 'EagleDocs apps are turned off on this server' });
    const bearer = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') ?? '')?.[1] ?? '';
    const principal = bearer ? await oauth.verify(bearer) : null;
    if (!principal) {
      res.setHeader('WWW-Authenticate', challenge());
      return void res.status(401).json({ error: 'invalid_token' });
    }
    const body = req.body as unknown;
    const messages = Array.isArray(body) ? body : [body];
    if (messages.length === 0 || messages.length > MAX_BATCH) {
      return void res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: `Send 1 to ${MAX_BATCH} messages per request` } });
    }
    const limit = await hitRateLimit(db, `mcp:http:${principal.grantId}`, 60_000, REQUESTS_PER_MINUTE);
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(limit.retryAfterSeconds));
      return void res.status(429).json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Too many requests' } });
    }
    const controller = new AbortController();
    req.on('close', () => !res.writableEnded && controller.abort());
    const replies = [];
    for (const message of messages) {
      try {
        const reply = await server.handle(principal, (message ?? {}) as Record<string, never>, controller.signal);
        if (reply) replies.push(reply);
      } catch (err) {
        logger.error('MCP request failed', err);
        replies.push({ jsonrpc: '2.0', id: (message as { id?: unknown })?.id ?? null, error: { code: -32603, message: 'Internal error' } });
      }
    }
    if (replies.length === 0) return void res.status(202).end();
    res.json(Array.isArray(body) ? replies : replies[0]);
  });

  // ---------------------------------------------------------------- signed in: consent screen and Settings → Apps
  consent.use(requireAuth);
  apps.use(requireAuth);
  consent.get('/requests/:id', async (req: AppRequest, res) => {
    res.json(await oauth.consent(routeParam(req.params.id)));
  });
  consent.post('/requests/:id', async (req: AppRequest, res) => {
    const body = (req.body ?? {}) as { approve?: unknown; scopes?: unknown };
    const result = await oauth.decide(req.user!.id, routeParam(req.params.id), body.approve === true, body.scopes);
    if (body.approve === true) logger.system.info(`"${req.user!.username}" connected an MCP app`);
    res.json(result);
  });
  apps.get('/', async (req: AppRequest, res) => {
    res.json({ enabled: enabled(), server_url: `${oauth.issuer}/mcp`, apps: await oauth.apps(req.user!.id) });
  });
  apps.delete('/:id', async (req: AppRequest, res) => {
    await oauth.revokeGrant(req.user!.id, routeParam(req.params.id));
    res.status(204).end();
  });
  return { open, consent, apps };
}
