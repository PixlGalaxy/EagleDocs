import { Router } from 'express';
import type { Db } from '../../db/pool.js';
import { many, maybe } from '../../db/pool.js';
import type { DiskWorkspace } from '../../engine/workspace.js';
import { requireAuth } from '../auth/session.middleware.js';
import type { AppRequest } from '../../types/index.js';
import type { TiersService } from '../billing/tiers.service.js';
import { CU_MS } from '../sandbox/compute-meter.js';
import type { SandboxManager } from '../sandbox/manager.js';

const MB = 1024 * 1024;
const HISTORY_DAYS = 7;

/** Settings → Usage: the student's plan, compute units, StudyHawk-model use and storage, in one call. */
export function createUsageRoutes(deps: { db: Db; tiers: TiersService; sandboxes: SandboxManager; workspace: DiskWorkspace }) {
  const { db, tiers, sandboxes, workspace } = deps;
  const router = Router();
  router.use(requireAuth);

  router.get('/', async (req: AppRequest, res) => {
    const userId = req.user!.id;
    const [limits, compute, today, history, storage, live] = await Promise.all([
      tiers.limitsFor(userId),
      sandboxes.computeStatus(userId),
      maybe<{ studyhawk_messages: number; messages: number; tokens_in: string; tokens_out: string }>(
        db,
        'SELECT studyhawk_messages, messages, tokens_in, tokens_out FROM usage_daily WHERE user_id = $1 AND day = current_date',
        [userId],
      ),
      many<{ day: string; compute_ms: string; messages: number }>(
        db,
        `SELECT to_char(d, 'YYYY-MM-DD') AS day, COALESCE(u.compute_ms, 0) AS compute_ms, COALESCE(u.studyhawk_messages, 0) AS messages
         FROM generate_series(current_date - ($2::int - 1), current_date, interval '1 day') AS d
         LEFT JOIN usage_daily u ON u.user_id = $1 AND u.day = d::date
         ORDER BY d`,
        [userId, HISTORY_DAYS],
      ),
      workspace.usage(userId),
      sandboxes.isRunning(userId) ? sandboxes.stats(userId) : Promise.resolve(null),
    ]);
    const [ws, temp] = storage;
    res.json({
      plan: { name: limits.name, cpu: limits.cpu, mem_mb: limits.memMb },
      compute: {
        day: { used: compute.day.usedCu, limit: compute.day.limitCu, resets_at: compute.day.resetsAt },
        week: { used: compute.week.usedCu, limit: compute.week.limitCu, resets_at: compute.week.resetsAt },
        throttled: compute.throttled,
        throttle_cpu: compute.throttleCpu,
        // The sandbox right now (null when it is not running).
        sandbox: live ? { cpu_percent: live.cpuPercent, mem_mb: live.memMb } : null,
      },
      models: {
        studyhawk_messages: today?.studyhawk_messages ?? 0,
        daily_limit: limits.dailyMessages || null,
        messages: today?.messages ?? 0,
        tokens_in: Number(today?.tokens_in ?? 0),
        tokens_out: Number(today?.tokens_out ?? 0),
      },
      storage: {
        used_mb: Math.round((ws?.usedBytes ?? 0) / MB),
        limit_mb: Math.round((ws?.limitBytes ?? 0) / MB),
        temp_used_mb: Math.round((temp?.usedBytes ?? 0) / MB),
        temp_limit_mb: Math.round((temp?.limitBytes ?? 0) / MB),
      },
      history: history.map((h) => ({ day: h.day, compute: Math.round((Number(h.compute_ms) / CU_MS) * 1000) / 1000, messages: h.messages })),
    });
  });

  return router;
}
