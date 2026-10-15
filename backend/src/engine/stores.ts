import type { ApprovalDecision, MemoryDoc, MemoryDocs, MemoryStore, PendingSteer, RunStore, Schedule, ScheduleStore, SkillStore, SkillSummary } from 'pixlai-engine';
import type { Bus } from '../bus/bus.js';
import type { Db } from '../db/pool.js';
import type { BuiltinSkills } from '../modules/skills/builtin.js';
import { many, maybe } from '../db/pool.js';

/**
 * PixlAI-Engine ports backed by Postgres. A run is keyed by its job id. Steers
 * and approval decisions can arrive on any replica: they are written to the
 * DB and announced with NOTIFY job_control, so the replica running the job
 * reacts at once.
 */
export class PgRunStore implements RunStore {
  private steerWatchers = new Map<string, Set<() => void>>();
  private approvalWatchers = new Map<string, Set<() => void>>();

  constructor(private db: Db, private bus: Bus) {}

  async start(): Promise<void> {
    await this.bus.on('job_control', ({ jobId, action }) => {
      const watchers = action === 'steer' ? this.steerWatchers : action === 'approval' ? this.approvalWatchers : null;
      for (const watcher of watchers?.get(jobId) ?? []) watcher();
    });
  }

  private watch(map: Map<string, Set<() => void>>, jobId: string, fn: () => void): () => void {
    const set = map.get(jobId) ?? new Set();
    set.add(fn);
    map.set(jobId, set);
    return () => {
      set.delete(fn);
      if (set.size === 0) map.delete(jobId);
    };
  }

  async takeSteers(jobId: string): Promise<PendingSteer[]> {
    return many<PendingSteer>(
      this.db,
      `WITH taken AS (
         UPDATE job_steers SET applied_at = now() WHERE job_id = $1 AND applied_at IS NULL RETURNING id, content, created_at
       ) SELECT id, content FROM taken ORDER BY created_at`,
      [jobId],
    );
  }

  watchSteers(jobId: string, onSteer: () => void): () => void {
    return this.watch(this.steerWatchers, jobId, onSteer);
  }

  async createApproval(input: { runId: string; userId: string; toolName: string; args: Record<string, unknown>; summary: string; details: Record<string, string> }) {
    const { rows } = await this.db.query<{ id: string }>(
      `INSERT INTO approvals (job_id, user_id, chat_id, tool_name, args, summary, details)
       SELECT $1, $2, chat_id, $3, $4, $5, $6 FROM jobs WHERE id = $1 RETURNING id`,
      [input.runId, input.userId, input.toolName, input.args, input.summary, input.details],
    );
    await this.db.query("UPDATE jobs SET status = 'waiting_approval' WHERE id = $1 AND status = 'running'", [input.runId]);
    return { id: rows[0]!.id };
  }

  waitForApproval(approvalId: string, timeoutMs: number, signal: AbortSignal): Promise<ApprovalDecision> {
    return new Promise((resolve) => {
      let settled = false;
      let unwatch = () => {};
      const finish = async (decision: ApprovalDecision | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearInterval(poll);
        unwatch();
        if (decision === 'expired') {
          await this.db.query("UPDATE approvals SET status = 'expired', decided_at = now() WHERE id = $1 AND status = 'pending'", [approvalId]);
        }
        const row = await maybe<{ job_id: string }>(this.db, 'SELECT job_id FROM approvals WHERE id = $1', [approvalId]);
        if (row) await this.db.query("UPDATE jobs SET status = 'running' WHERE id = $1 AND status = 'waiting_approval'", [row.job_id]);
        resolve(decision ?? 'rejected');
      };
      const check = async () => {
        const row = await maybe<{ status: string; job_id: string }>(this.db, 'SELECT status, job_id FROM approvals WHERE id = $1', [approvalId]);
        if (!row) return finish('expired');
        if (row.status === 'approved' || row.status === 'rejected' || row.status === 'expired') return finish(row.status);
        return undefined;
      };
      const timer = setTimeout(() => void finish('expired'), timeoutMs);
      // NOTIFY wakes us at once; the poll covers a notification lost during a reconnect.
      const poll = setInterval(() => void check().catch(() => undefined), 15_000);
      void maybe<{ job_id: string }>(this.db, 'SELECT job_id FROM approvals WHERE id = $1', [approvalId]).then((row) => {
        if (row) unwatch = this.watch(this.approvalWatchers, row.job_id, () => void check().catch(() => undefined));
        void check().catch(() => undefined);
      });
      signal.addEventListener('abort', () => void finish('rejected'), { once: true });
    });
  }
}

/** SOUL.md, USER.md and MEMORY.md per student (agent_docs). The agent cannot write while the student paused memory. */
export class PgMemoryStore implements MemoryStore {
  constructor(private db: Db) {}

  async read(userId: string): Promise<MemoryDocs> {
    const rows = await many<{ doc: MemoryDoc; content: string }>(this.db, 'SELECT doc, content FROM agent_docs WHERE user_id = $1', [userId]);
    const docs: MemoryDocs = { soul: '', user: '', notes: '' };
    for (const row of rows) docs[row.doc] = row.content;
    return docs;
  }

  async write(userId: string, doc: MemoryDoc, content: string): Promise<void> {
    const paused = await maybe<{ memory_paused: boolean }>(this.db, 'SELECT memory_paused FROM users WHERE id = $1', [userId]);
    if (paused?.memory_paused) throw new Error('The user turned memory off. Do not try again; tell them if it matters.');
    await writeAgentDoc(this.db, userId, doc, content);
  }
}

export async function writeAgentDoc(db: Db, userId: string, doc: MemoryDoc, content: string): Promise<void> {
  await db.query(
    `INSERT INTO agent_docs (user_id, doc, content, updated_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (user_id, doc) DO UPDATE SET content = $3, updated_at = now()`,
    [userId, doc, content],
  );
}

/** Built-in skills the student's institution offers (placeholders filled for them), then their own. */
export class PgSkillStore implements SkillStore {
  constructor(
    private db: Db,
    private builtins: BuiltinSkills,
  ) {}

  async list(userId: string): Promise<SkillSummary[]> {
    const own = await many<SkillSummary>(
      this.db,
      'SELECT slug, name, description FROM user_skills WHERE user_id = $1 AND enabled ORDER BY name',
      [userId],
    );
    const builtin = (await this.builtins.available(userId)).map(({ slug, name, description }) => ({ slug, name, description }));
    return [...builtin, ...own.filter((s) => !this.builtins.get(s.slug))];
  }

  async load(userId: string, slug: string) {
    const notesOf = async () =>
      (
        await many<{ note: string }>(
          this.db,
          'SELECT note FROM skill_notes WHERE user_id = $1 AND skill_slug = $2 ORDER BY created_at DESC LIMIT 20',
          [userId, slug],
        )
      ).map((n) => n.note);
    const builtin = (await this.builtins.available(userId)).find((s) => s.slug === slug);
    if (builtin) return { name: builtin.name, body: await this.builtins.render(userId, builtin), notes: await notesOf() };
    if (this.builtins.get(slug)) return null; // Built-in but not offered to this student.
    const skill = await maybe<{ name: string; body_md: string }>(
      this.db,
      'SELECT name, body_md FROM user_skills WHERE user_id = $1 AND slug = $2 AND enabled',
      [userId, slug],
    );
    if (!skill) return null;
    const notes = await many<{ note: string }>(
      this.db,
      'SELECT note FROM skill_notes WHERE user_id = $1 AND skill_slug = $2 ORDER BY created_at DESC LIMIT 20',
      [userId, slug],
    );
    return { name: skill.name, body: skill.body_md, notes: notes.map((n) => n.note) };
  }

  async addNote(userId: string, slug: string, note: string): Promise<void> {
    await this.db.query('INSERT INTO skill_notes (user_id, skill_slug, note) VALUES ($1, $2, $3)', [userId, slug, note]);
  }
}

interface ScheduleRow {
  id: string;
  name: string;
  schedule: string;
  timezone: string;
  prompt: string;
  enabled: boolean;
  next_run_at: Date | null;
  last_run_at: Date | null;
}

const toSchedule = (r: ScheduleRow): Schedule => ({
  id: r.id,
  name: r.name,
  schedule: r.schedule,
  timezone: r.timezone,
  prompt: r.prompt,
  enabled: r.enabled,
  nextRunAt: r.next_run_at?.toISOString() ?? null,
  lastRunAt: r.last_run_at?.toISOString() ?? null,
});

export class PgScheduleStore implements ScheduleStore {
  constructor(private db: Db) {}

  async list(userId: string): Promise<Schedule[]> {
    const rows = await many<ScheduleRow>(this.db, 'SELECT * FROM schedules WHERE user_id = $1 ORDER BY created_at', [userId]);
    return rows.map(toSchedule);
  }

  async create(userId: string, input: Omit<Schedule, 'id' | 'lastRunAt'>): Promise<Schedule> {
    const { rows } = await this.db.query<ScheduleRow>(
      `INSERT INTO schedules (user_id, name, schedule, timezone, prompt, enabled, next_run_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [userId, input.name, input.schedule, input.timezone, input.prompt, input.enabled, input.nextRunAt],
    );
    return toSchedule(rows[0]!);
  }

  async update(userId: string, id: string, patch: Partial<Omit<Schedule, 'id'>>): Promise<Schedule | null> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const columns: Record<string, unknown> = {};
    if (patch.name !== undefined) columns.name = patch.name;
    if (patch.schedule !== undefined) columns.schedule = patch.schedule;
    if (patch.timezone !== undefined) columns.timezone = patch.timezone;
    if (patch.prompt !== undefined) columns.prompt = patch.prompt;
    if (patch.enabled !== undefined) columns.enabled = patch.enabled;
    if (patch.nextRunAt !== undefined) columns.next_run_at = patch.nextRunAt;
    const keys = Object.keys(columns);
    if (keys.length === 0) return (await this.list(userId)).find((s) => s.id === id) ?? null;
    const { rows } = await this.db.query<ScheduleRow>(
      `UPDATE schedules SET ${keys.map((k, i) => `${k} = $${i + 3}`).join(', ')} WHERE id = $1 AND user_id = $2 RETURNING *`,
      [id, userId, ...keys.map((k) => columns[k])],
    );
    return rows[0] ? toSchedule(rows[0]) : null;
  }

  async remove(userId: string, id: string): Promise<boolean> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
    const result = await this.db.query('DELETE FROM schedules WHERE id = $1 AND user_id = $2', [id, userId]);
    return (result.rowCount ?? 0) > 0;
  }
}
