import { Router } from 'express';
import { planSchedule } from 'pixlai-engine';
import type { Db } from '../../db/pool.js';
import { many, maybe } from '../../db/pool.js';
import { badRequest, notFound, withDetail } from '../../errors.js';
import { routeParam } from '../../route-params.js';
import type { AppRequest } from '../../types/index.js';
import { requireAuth } from '../auth/session.middleware.js';

const UUID = /^[0-9a-f-]{36}$/i;
const id = (req: AppRequest) => {
  const value = routeParam(req.params.id);
  if (!UUID.test(value)) throw notFound();
  return value;
};

/** Settings -> Memory, Schedules and Skills: what the agent keeps per user, visible and editable. */
export function createAgentDataRoutes(db: Db) {
  const memories = Router();
  const schedules = Router();
  const skills = Router();
  for (const r of [memories, schedules, skills]) r.use(requireAuth);

  // ---------------------------------------------------------------- memory

  memories.get('/', async (req: AppRequest, res) => {
    const rows = await many(db, 'SELECT id, content, source, created_at FROM memories WHERE user_id = $1 ORDER BY created_at DESC', [req.user!.id]);
    const user = await maybe<{ memory_paused: boolean }>(db, 'SELECT memory_paused FROM users WHERE id = $1', [req.user!.id]);
    res.json({ memories: rows, paused: user?.memory_paused ?? false });
  });

  memories.patch('/:id', async (req: AppRequest, res) => {
    const content = (req.body as { content?: unknown })?.content;
    if (typeof content !== 'string' || !content.trim() || content.length > 500) throw badRequest('error.invalidInput');
    const row = await maybe(
      db,
      'UPDATE memories SET content = $3, source = $4, updated_at = now() WHERE id = $1 AND user_id = $2 RETURNING id, content, source, created_at',
      [id(req), req.user!.id, content.trim(), 'user'],
    );
    if (!row) throw notFound();
    res.json(row);
  });

  memories.delete('/:id', async (req: AppRequest, res) => {
    const result = await db.query('DELETE FROM memories WHERE id = $1 AND user_id = $2', [id(req), req.user!.id]);
    if (result.rowCount === 0) throw notFound();
    res.status(204).end();
  });

  memories.put('/paused', async (req: AppRequest, res) => {
    await db.query('UPDATE users SET memory_paused = $2 WHERE id = $1', [req.user!.id, (req.body as { paused?: unknown })?.paused === true]);
    res.status(204).end();
  });

  // ---------------------------------------------------------------- schedules

  const scheduleView = 'id, name, schedule AS cron, prompt, enabled, next_run_at, last_run_at, timezone';

  schedules.get('/', async (req: AppRequest, res) => {
    res.json(await many(db, `SELECT ${scheduleView} FROM schedules WHERE user_id = $1 ORDER BY created_at`, [req.user!.id]));
  });

  const plan = (schedule: string, timezone: string) => {
    try {
      return planSchedule(schedule, timezone, new Date()).nextRunAt;
    } catch (err) {
      throw withDetail(badRequest('schedules.invalid'), (err as Error).message);
    }
  };

  schedules.post('/', async (req: AppRequest, res) => {
    const body = (req.body ?? {}) as { name?: unknown; cron?: unknown; prompt?: unknown; enabled?: unknown };
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    const schedule = typeof body.cron === 'string' ? body.cron.trim() : '';
    if (!name || !prompt || prompt.length > 2000) throw badRequest('schedules.invalid');
    const timezone = req.user!.timezone || 'America/New_York';
    const count = await maybe<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM schedules WHERE user_id = $1', [req.user!.id]);
    if ((count?.n ?? 0) >= 10) throw badRequest('schedules.limit');
    const row = await maybe(
      db,
      `INSERT INTO schedules (user_id, name, schedule, timezone, prompt, enabled, next_run_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${scheduleView}`,
      [req.user!.id, name, schedule, timezone, prompt, body.enabled !== false, plan(schedule, timezone)],
    );
    res.status(201).json(row);
  });

  schedules.patch('/:id', async (req: AppRequest, res) => {
    const current = await maybe<{ schedule: string; timezone: string; enabled: boolean; name: string; prompt: string }>(
      db,
      'SELECT schedule, timezone, enabled, name, prompt FROM schedules WHERE id = $1 AND user_id = $2',
      [id(req), req.user!.id],
    );
    if (!current) throw notFound();
    const body = (req.body ?? {}) as { name?: unknown; cron?: unknown; prompt?: unknown; enabled?: unknown };
    const schedule = typeof body.cron === 'string' ? body.cron.trim() : current.schedule;
    const enabled = typeof body.enabled === 'boolean' ? body.enabled : current.enabled;
    const row = await maybe(
      db,
      `UPDATE schedules SET name = $3, schedule = $4, prompt = $5, enabled = $6, next_run_at = $7
       WHERE id = $1 AND user_id = $2 RETURNING ${scheduleView}`,
      [
        id(req),
        req.user!.id,
        typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 80) : current.name,
        schedule,
        typeof body.prompt === 'string' && body.prompt.trim() ? body.prompt.trim().slice(0, 2000) : current.prompt,
        enabled,
        enabled ? plan(schedule, current.timezone) : null,
      ],
    );
    res.json(row);
  });

  schedules.delete('/:id', async (req: AppRequest, res) => {
    const result = await db.query('DELETE FROM schedules WHERE id = $1 AND user_id = $2', [id(req), req.user!.id]);
    if (result.rowCount === 0) throw notFound();
    res.status(204).end();
  });

  // ---------------------------------------------------------------- personal skills (built-ins arrive in phase 5)

  const skillView = async (userId: string) => {
    const rows = await many<{ slug: string; name: string; description: string; body_md: string; enabled: boolean }>(
      db,
      'SELECT slug, name, description, body_md, enabled FROM user_skills WHERE user_id = $1 ORDER BY name',
      [userId],
    );
    const notes = await many<{ id: string; skill_slug: string; note: string; created_at: Date }>(
      db,
      'SELECT id, skill_slug, note, created_at FROM skill_notes WHERE user_id = $1 ORDER BY created_at DESC',
      [userId],
    );
    return rows.map((s) => ({
      ...s,
      builtin: false,
      notes: notes.filter((n) => n.skill_slug === s.slug).map(({ id: noteId, note, created_at }) => ({ id: noteId, note, created_at })),
    }));
  };

  const parseSkill = (body: Record<string, unknown>) => {
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 64) : '';
    const description = typeof body.description === 'string' ? body.description.trim().slice(0, 300) : '';
    const bodyMd = typeof body.body_md === 'string' ? body.body_md : '';
    if (!name || bodyMd.length > 50_000) throw badRequest('error.invalidInput');
    return { name, description, bodyMd };
  };
  const slugify = (name: string) => name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'skill';

  skills.get('/', async (req: AppRequest, res) => res.json(await skillView(req.user!.id)));

  skills.post('/', async (req: AppRequest, res) => {
    const input = parseSkill((req.body ?? {}) as Record<string, unknown>);
    let slug = slugify(input.name);
    const taken = await maybe(db, 'SELECT 1 FROM user_skills WHERE user_id = $1 AND slug = $2', [req.user!.id, slug]);
    if (taken) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
    await db.query('INSERT INTO user_skills (user_id, slug, name, description, body_md) VALUES ($1, $2, $3, $4, $5)', [
      req.user!.id,
      slug,
      input.name,
      input.description,
      input.bodyMd,
    ]);
    res.status(201).json((await skillView(req.user!.id)).find((s) => s.slug === slug));
  });

  skills.put('/:slug', async (req: AppRequest, res) => {
    const input = parseSkill((req.body ?? {}) as Record<string, unknown>);
    const slug = routeParam(req.params.slug);
    const result = await db.query('UPDATE user_skills SET name = $3, description = $4, body_md = $5 WHERE user_id = $1 AND slug = $2', [
      req.user!.id,
      slug,
      input.name,
      input.description,
      input.bodyMd,
    ]);
    if (result.rowCount === 0) throw notFound();
    res.json((await skillView(req.user!.id)).find((s) => s.slug === slug));
  });

  skills.put('/:slug/enabled', async (req: AppRequest, res) => {
    const slug = routeParam(req.params.slug);
    const enabled = (req.body as { enabled?: unknown })?.enabled === true;
    const result = await db.query('UPDATE user_skills SET enabled = $3 WHERE user_id = $1 AND slug = $2', [req.user!.id, slug, enabled]);
    if (result.rowCount === 0) throw notFound();
    res.json((await skillView(req.user!.id)).find((s) => s.slug === slug));
  });

  skills.delete('/:slug/notes/:id', async (req: AppRequest, res) => {
    await db.query('DELETE FROM skill_notes WHERE id = $1 AND user_id = $2', [id(req), req.user!.id]);
    res.status(204).end();
  });

  skills.delete('/:slug', async (req: AppRequest, res) => {
    const result = await db.query('DELETE FROM user_skills WHERE user_id = $1 AND slug = $2', [req.user!.id, routeParam(req.params.slug)]);
    if (result.rowCount === 0) throw notFound();
    res.status(204).end();
  });

  return { memories, schedules, skills };
}
