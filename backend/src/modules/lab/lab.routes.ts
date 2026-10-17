import { Router } from 'express';
import type { Db } from '../../db/pool.js';
import { maybe } from '../../db/pool.js';
import type { SettingsService } from '../../db/settings.js';
import { badRequest } from '../../errors.js';
import { SETTINGS_KEYS as K } from '../admin/settings-keys.js';
import { requireAdmin } from '../auth/session.middleware.js';

/** Servers live on the private network: plain http(s) addresses only. */
const URL_RE = /^https?:\/\/[^\s/]+(\/[^\s]*)?$/i;

/** Admin → Accelerator Lab: the switch, the GPU servers and models, and how the queue is doing. */
export function createLabAdminRoutes(deps: { db: Db; settings: SettingsService }) {
  const { db, settings } = deps;
  const router = Router();
  router.use(requireAdmin);

  const current = () => ({
    enabled: settings.getBoolean(K.labEnabled, false),
    ollama_url: settings.getString(K.labOllamaUrl, ''),
    vision_model: settings.getString(K.labVisionModel, ''),
    text_model: settings.getString(K.labTextModel, ''),
    embed_model: settings.getString(K.labEmbedModel, ''),
    whisper_url: settings.getString(K.labWhisperUrl, ''),
    whisper_model: settings.getString(K.labWhisperModel, ''),
    max_queued_per_user: settings.getNumber(K.labMaxQueued, 200),
  });

  router.get('/lab', async (_req, res) => {
    const queue = await maybe<{ queued: number; running: number; done_day: number; cached_day: number; failed_day: number; gpu_ms_day: string; wait_ms: string | null; node: string | null }>(
      db,
      `SELECT COUNT(*) FILTER (WHERE status = 'queued')::int AS queued,
              COUNT(*) FILTER (WHERE status = 'running')::int AS running,
              COUNT(*) FILTER (WHERE status = 'done' AND finished_at > now() - interval '1 day')::int AS done_day,
              COUNT(*) FILTER (WHERE status = 'done' AND gpu_ms = 0 AND cache_key IS NOT NULL AND finished_at > now() - interval '1 day')::int AS cached_day,
              COUNT(*) FILTER (WHERE status = 'failed' AND finished_at > now() - interval '1 day')::int AS failed_day,
              COALESCE(SUM(gpu_ms) FILTER (WHERE finished_at > now() - interval '1 day'), 0) AS gpu_ms_day,
              AVG(EXTRACT(EPOCH FROM (started_at - created_at)) * 1000) FILTER (WHERE finished_at > now() - interval '1 day') AS wait_ms,
              (SELECT node_id FROM lab_tasks WHERE node_id IS NOT NULL ORDER BY started_at DESC NULLS LAST LIMIT 1) AS node
       FROM lab_tasks`,
    );
    res.json({
      settings: current(),
      queue: {
        queued: queue?.queued ?? 0,
        running: queue?.running ?? 0,
        done_day: queue?.done_day ?? 0,
        cached_day: queue?.cached_day ?? 0,
        failed_day: queue?.failed_day ?? 0,
        gpu_minutes_day: Math.round(Number(queue?.gpu_ms_day ?? 0) / 600) / 100,
        avg_wait_seconds: queue?.wait_ms ? Math.round(Number(queue.wait_ms) / 1000) : null,
        worker_node: queue?.node ?? null,
      },
    });
  });

  router.put('/lab', async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const updates: Record<string, unknown> = {};
    if (body.enabled !== undefined) updates[K.labEnabled] = body.enabled === true;
    for (const [field, key] of [
      ['ollama_url', K.labOllamaUrl],
      ['whisper_url', K.labWhisperUrl],
    ] as const) {
      if (body[field] === undefined) continue;
      const value = String(body[field]).trim();
      if (value && !URL_RE.test(value)) throw badRequest('error.invalidInput');
      updates[key] = value;
    }
    for (const [field, key] of [
      ['vision_model', K.labVisionModel],
      ['text_model', K.labTextModel],
      ['embed_model', K.labEmbedModel],
      ['whisper_model', K.labWhisperModel],
    ] as const) {
      if (body[field] === undefined) continue;
      const value = String(body[field]).trim();
      if (value.length > 120 || /\s/.test(value)) throw badRequest('error.invalidInput');
      updates[key] = value;
    }
    if (body.max_queued_per_user !== undefined) {
      const n = Number(body.max_queued_per_user);
      if (!Number.isInteger(n) || n < 1 || n > 10_000) throw badRequest('error.invalidInput');
      updates[K.labMaxQueued] = n;
    }
    if (Object.keys(updates).length) await settings.setMany(updates);
    res.json({ settings: current() });
  });

  /** The models the Lab's Ollama has, for the admin's pickers (it answers only on the private network). */
  router.get('/lab/models', async (_req, res) => {
    const url = settings.getString(K.labOllamaUrl, '').trim().replace(/\/+$/, '');
    if (!url) {
      res.json({ models: [], error: null });
      return;
    }
    try {
      const r = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) {
        res.json({ models: [], error: `Ollama answered ${r.status}` });
        return;
      }
      const data = (await r.json()) as { models?: { name: string; size?: number }[] };
      res.json({ models: (data.models ?? []).map((m) => ({ name: m.name, size_mb: Math.round((m.size ?? 0) / 1048576) })), error: null });
    } catch (err) {
      res.json({ models: [], error: (err as Error).message });
    }
  });

  return router;
}
