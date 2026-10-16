import type { Db } from '../../db/pool.js';
import { many, maybe } from '../../db/pool.js';
import { withTx } from '../../db/tx.js';
import { badRequest, conflict, notFound } from '../../errors.js';

/** frontend/src/api/types.ts `Tier` */
export interface TierRow {
  id: string;
  name: string;
  sort: number;
  price_cents: number;
  currency: string;
  stripe_price_id: string | null;
  cpu: number;
  mem_mb: number;
  disk_mb: number;
  daily_messages: number;
  max_background_jobs: number;
  max_schedules: number;
  max_parallel_subagents: number;
  max_subagent_depth: number;
  mcp_daily_calls: number;
  mcp_daily_code_runs: number;
  is_default: boolean;
  enabled: boolean;
}

/** What a student may use right now, from their plan (or the default plan). */
export interface TierLimits {
  tierId: string | null;
  name: string;
  cpu: number;
  memMb: number;
  diskMb: number;
  /** StudyHawk-model turns per day; 0 = unlimited. */
  dailyMessages: number;
  maxBackgroundJobs: number;
  maxSchedules: number;
  maxParallelSubagents: number;
  maxSubagentDepth: number;
  /** From ChatGPT/Claude per day; 0 = unlimited. */
  mcpDailyCalls: number;
  mcpDailyCodeRuns: number;
}

/** Used only if the tiers table is empty (it never is after the migration's seed). */
const FALLBACK: TierLimits = {
  tierId: null,
  name: 'Free',
  cpu: 1,
  memMb: 2048,
  diskMb: 5120,
  dailyMessages: 100,
  maxBackgroundJobs: 2,
  maxSchedules: 3,
  maxParallelSubagents: 3,
  maxSubagentDepth: 2,
  mcpDailyCalls: 300,
  mcpDailyCodeRuns: 40,
};

const COLUMNS = `id, name, sort, price_cents, currency, stripe_price_id, cpu::float8 AS cpu, mem_mb, disk_mb, daily_messages,
  max_background_jobs, max_schedules, max_parallel_subagents, max_subagent_depth, mcp_daily_calls, mcp_daily_code_runs, is_default, enabled`;

/** Plans live a few seconds in each replica: limits are read on every message, sandbox start and file write. */
const CACHE_MS = 15_000;

function toLimits(row: TierRow): TierLimits {
  return {
    tierId: row.id,
    name: row.name,
    cpu: Number(row.cpu),
    memMb: row.mem_mb,
    diskMb: row.disk_mb,
    dailyMessages: row.daily_messages,
    maxBackgroundJobs: row.max_background_jobs,
    maxSchedules: row.max_schedules,
    maxParallelSubagents: row.max_parallel_subagents,
    maxSubagentDepth: row.max_subagent_depth,
    mcpDailyCalls: row.mcp_daily_calls,
    mcpDailyCodeRuns: row.mcp_daily_code_runs,
  };
}

const NUMBER_FIELDS: [keyof TierRow, number, number][] = [
  ['sort', -1000, 1000],
  ['price_cents', 0, 10_000_000],
  ['cpu', 0.1, 16],
  ['mem_mb', 256, 65_536],
  ['disk_mb', 100, 2_000_000],
  ['daily_messages', 0, 1_000_000],
  ['max_background_jobs', 1, 50],
  ['max_schedules', 0, 500],
  ['max_parallel_subagents', 1, 10],
  ['max_subagent_depth', 0, 3],
  ['mcp_daily_calls', 0, 1_000_000],
  ['mcp_daily_code_runs', 0, 1_000_000],
];

export class TiersService {
  private cache = new Map<string, { at: number; limits: TierLimits }>();

  constructor(private db: Db) {}

  list(): Promise<TierRow[]> {
    return many<TierRow>(this.db, `SELECT ${COLUMNS} FROM tiers ORDER BY sort, price_cents, name`);
  }

  get(id: string): Promise<TierRow | undefined> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return Promise.resolve(undefined);
    return maybe<TierRow>(this.db, `SELECT ${COLUMNS} FROM tiers WHERE id = $1`, [id]);
  }

  byStripePrice(priceId: string): Promise<TierRow | undefined> {
    return maybe<TierRow>(this.db, `SELECT ${COLUMNS} FROM tiers WHERE stripe_price_id = $1`, [priceId]);
  }

  /** The plan a student has now (assigned and not expired, else the default). */
  async limitsFor(userId: string): Promise<TierLimits> {
    const hit = this.cache.get(userId);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.limits;
    const row = await maybe<TierRow>(this.db, `SELECT ${COLUMNS} FROM tiers WHERE id = effective_tier($1)`, [userId]);
    const limits = row ? toLimits(row) : FALLBACK;
    this.cache.set(userId, { at: Date.now(), limits });
    return limits;
  }

  /** After a plan change: the next read sees it on this replica (others within CACHE_MS). */
  forget(userId?: string): void {
    if (userId) this.cache.delete(userId);
    else this.cache.clear();
  }

  private parse(body: Record<string, unknown>, partial: boolean): Partial<TierRow> {
    const out: Partial<TierRow> = {};
    if (body.name !== undefined || !partial) {
      const name = typeof body.name === 'string' ? body.name.trim().slice(0, 40) : '';
      if (!name) throw badRequest('tiers.nameRequired');
      out.name = name;
    }
    for (const [key, min, max] of NUMBER_FIELDS) {
      if (body[key] === undefined) continue;
      const value = Number(body[key]);
      if (!Number.isFinite(value) || value < min || value > max) throw badRequest('tiers.invalidLimit');
      (out as Record<string, number>)[key] = key === 'cpu' ? Math.round(value * 100) / 100 : Math.round(value);
    }
    if (body.currency !== undefined) {
      const currency = String(body.currency).toLowerCase();
      if (!/^[a-z]{3}$/.test(currency)) throw badRequest('tiers.invalidLimit');
      out.currency = currency;
    }
    if (body.stripe_price_id !== undefined) {
      const price = typeof body.stripe_price_id === 'string' ? body.stripe_price_id.trim() : '';
      if (price && !/^price_[A-Za-z0-9]{6,}$/.test(price)) throw badRequest('tiers.invalidPrice');
      out.stripe_price_id = price || null;
    }
    if (body.enabled !== undefined) out.enabled = body.enabled === true;
    if (body.is_default !== undefined) out.is_default = body.is_default === true;
    return out;
  }

  private async save(id: string | null, fields: Partial<TierRow>): Promise<TierRow> {
    const saved = await withTx(this.db, async (client) => {
      // One default plan: making this one the default takes the flag from the other.
      if (fields.is_default) await client.query('UPDATE tiers SET is_default = false WHERE is_default AND id IS DISTINCT FROM $1', [id]);
      if (fields.is_default === false && id) {
        const current = await client.query('SELECT 1 FROM tiers WHERE id = $1 AND is_default', [id]);
        if (current.rowCount) throw conflict('tiers.needsDefault');
      }
      const keys = Object.keys(fields);
      if (id === null) {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO tiers (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
          keys.map((k) => fields[k as keyof TierRow]),
        );
        return rows[0]!.id;
      }
      if (keys.length) {
        const result = await client.query(
          `UPDATE tiers SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`,
          [id, ...keys.map((k) => fields[k as keyof TierRow])],
        );
        if (!result.rowCount) throw notFound();
      }
      return id;
    }).catch((err: { code?: string }) => {
      if (err.code === '23505') throw conflict('tiers.priceTaken');
      throw err;
    });
    this.forget();
    return (await this.get(saved))!;
  }

  create(body: Record<string, unknown>): Promise<TierRow> {
    return this.save(null, this.parse(body, false));
  }

  update(id: string, body: Record<string, unknown>): Promise<TierRow> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound();
    return this.save(id, this.parse(body, true));
  }

  /** Students on it go back to the default plan (the foreign key clears their tier_id). */
  async remove(id: string): Promise<void> {
    const tier = await this.get(id);
    if (!tier) throw notFound();
    if (tier.is_default) throw conflict('tiers.needsDefault');
    await this.db.query('DELETE FROM tiers WHERE id = $1', [id]);
    this.forget();
  }
}
