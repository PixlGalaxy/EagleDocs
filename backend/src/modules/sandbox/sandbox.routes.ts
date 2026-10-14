import { Router } from 'express';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { Bus } from '../../bus/bus.js';
import type { EnvConfig } from '../../config/env.js';
import type { Db } from '../../db/pool.js';
import { many } from '../../db/pool.js';
import type { SettingsService } from '../../db/settings.js';
import { badRequest, notFound } from '../../errors.js';
import { logger } from '../../logger.js';
import { routeParam } from '../../route-params.js';
import type { AppRequest } from '../../types/index.js';
import { normalizeDomain } from '../../engine/browser-policy.js';
import type { SandboxTools } from '../../engine/sandbox.js';
import { BROWSER_DIR, type DiskWorkspace } from '../../engine/workspace.js';
import { requireAdmin, requireAuth } from '../auth/session.middleware.js';
import { SETTINGS_KEYS as K } from '../admin/settings-keys.js';
import type { SandboxManager } from './manager.js';

const MB = 1048576;
const UUID = /^[0-9a-f-]{36}$/i;
const MAX_TRUSTED = 50;

/** Admin → Sandbox: limits, the live list and stopping a user's sandbox. */
export function createSandboxAdminRoutes(deps: { db: Db; bus: Bus; config: EnvConfig; settings: SettingsService; sandboxes: SandboxManager; workspace: DiskWorkspace }) {
  const { db, bus, config, settings, sandboxes, workspace } = deps;
  const router = Router();
  router.use(requireAdmin);

  const view = () => {
    const limits = sandboxes.limits();
    return {
      enabled: sandboxes.enabled,
      image: limits.image,
      default_cpu: limits.cpu,
      default_mem_mb: limits.memMb,
      default_disk_mb: settings.getNumber(K.sandboxDiskMb, 5120),
      max_active_per_node: limits.maxActive,
      idle_timeout_minutes: limits.idleMinutes,
      // Egress filtering needs a proxy (planned); today the sandbox network is open.
      network: 'open' as const,
      network_list: [] as string[],
    };
  };

  router.get('/sandbox', (_req, res) => res.json(view()));

  router.put('/sandbox', async (req: AppRequest, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const num = (key: string, min: number, max: number) => {
      const value = Number(body[key]);
      if (!Number.isFinite(value) || value < min || value > max) throw badRequest('error.invalidInput');
      return value;
    };
    const image = String(body.image ?? '').trim();
    if (!/^[a-z0-9][a-z0-9._\-/:@]{2,200}$/i.test(image)) throw badRequest('error.invalidInput');
    await settings.setMany({
      [K.sandboxImage]: image,
      [K.sandboxCpu]: num('default_cpu', 0.1, 8),
      [K.sandboxMemMb]: Math.round(num('default_mem_mb', 256, 16384)),
      [K.sandboxDiskMb]: Math.round(num('default_disk_mb', 100, 1_000_000)),
      [K.sandboxMaxActive]: Math.round(num('max_active_per_node', 1, 200)),
      [K.sandboxIdleMinutes]: Math.round(num('idle_timeout_minutes', 1, 1440)),
    });
    logger.system.info(`"${req.user!.username}" updated the sandbox settings`);
    res.json(view());
  });

  router.get('/sandboxes', async (_req, res) => {
    const rows = await many<{ user_id: string; username: string; node_id: string; status: string; mem_limit_mb: number; last_active_at: Date; working: boolean }>(
      db,
      `SELECT s.user_id, u.username, s.node_id, s.status, s.mem_limit_mb, s.last_active_at,
              EXISTS (SELECT 1 FROM jobs j WHERE j.user_id = s.user_id AND j.status IN ('running', 'waiting_approval', 'waiting_mfa')) AS working
         FROM sandboxes s JOIN users u ON u.id = s.user_id
        ORDER BY s.last_active_at DESC`,
    );
    const out = await Promise.all(
      rows.map(async (row) => {
        // Live numbers only for sandboxes on this replica; the others show their limits.
        const stats = row.node_id === config.NODE_ID ? await sandboxes.stats(row.user_id) : null;
        const [ws] = await workspace.usage(row.user_id).catch(() => [undefined]);
        return {
          user_id: row.user_id,
          username: row.username,
          node_id: row.node_id,
          status: row.status,
          activity: row.status === 'starting' || row.working ? 'working' : 'idle',
          cpu_percent: stats?.cpuPercent ?? null,
          mem_mb: stats?.memMb ?? null,
          mem_limit_mb: row.mem_limit_mb,
          disk_used_mb: ws ? Math.round(ws.usedBytes / MB) : 0,
          disk_limit_mb: ws ? Math.round(ws.limitBytes / MB) : 0,
          last_active_at: row.last_active_at,
        };
      }),
    );
    res.json(out);
  });

  router.post('/sandboxes/:userId/stop', async (req: AppRequest, res) => {
    const userId = routeParam(req.params.userId);
    if (!UUID.test(userId)) throw notFound();
    if (sandboxes.isRunning(userId)) await sandboxes.stop(userId, `stopped by ${req.user!.username}`);
    // On another replica: its owner stops it.
    else await bus.publish('sandbox_control', { userId, action: 'stop' });
    res.status(204).end();
  });

  return router;
}

/** Settings → Browser: sites the agent may act on without asking, and clearing a profile's cookies. */
export function createBrowserRoutes(deps: { db: Db; config: EnvConfig; sandboxes: SandboxManager; tools: SandboxTools | undefined }) {
  const { db, config, sandboxes, tools } = deps;
  const router = Router();
  router.use(requireAuth);

  router.get('/', async (req: AppRequest, res) => {
    const userId = req.user!.id;
    const trusted = await many<{ domain: string; created_at: Date }>(
      db,
      'SELECT domain, created_at FROM browser_trusted_domains WHERE user_id = $1 ORDER BY domain',
      [userId],
    );
    const dir = join(config.DATA_ROOT, 'workspaces', userId, BROWSER_DIR);
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    const profiles = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
    res.json({ available: sandboxes.enabled, trusted, profiles });
  });

  router.post('/trusted', async (req: AppRequest, res) => {
    const domain = normalizeDomain(String((req.body as { domain?: unknown })?.domain ?? ''));
    if (!domain) throw badRequest('browser.invalidDomain');
    if (/(^|\.)instructure\.com$/.test(domain)) throw badRequest('browser.canvasReadOnly');
    const count = await many<{ n: number }>(db, 'SELECT COUNT(*)::int AS n FROM browser_trusted_domains WHERE user_id = $1', [req.user!.id]);
    if ((count[0]?.n ?? 0) >= MAX_TRUSTED) throw badRequest('error.invalidInput');
    await db.query('INSERT INTO browser_trusted_domains (user_id, domain) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.user!.id, domain]);
    res.status(201).json({ domain });
  });

  router.delete('/trusted/:domain', async (req: AppRequest, res) => {
    await db.query('DELETE FROM browser_trusted_domains WHERE user_id = $1 AND domain = $2', [req.user!.id, routeParam(req.params.domain)]);
    res.status(204).end();
  });

  /** Signs the agent out of every site in that profile. */
  router.delete('/profiles/:profile', async (req: AppRequest, res) => {
    const profile = routeParam(req.params.profile);
    if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(profile)) throw notFound();
    const userId = req.user!.id;
    await tools?.close(userId, profile);
    await fs.rm(join(config.DATA_ROOT, 'workspaces', userId, BROWSER_DIR, profile), { recursive: true, force: true });
    res.status(204).end();
  });

  return router;
}
