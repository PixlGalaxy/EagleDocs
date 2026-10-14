import type { Bus } from '../../bus/bus.js';
import type { Db } from '../../db/pool.js';
import { logger } from '../../logger.js';

/** Any event the chat stream carries (engine events plus done/error). */
export type JobEvent = { type: string; [key: string]: unknown };

const DELTA_FLUSH_MS = 100;

/**
 * Persists a job's events in order in `job_events` and announces them with
 * NOTIFY, so whichever replica holds the browser's SSE connection can stream
 * them. Text deltas are merged and written every ~100 ms instead of one row
 * per token. The job's own worker is the only writer, so it owns `seq`.
 */
export class JobEventWriter {
  private seq = 0;
  private pendingText = '';
  private timer: ReturnType<typeof setTimeout> | null = null;
  private chain: Promise<void> = Promise.resolve();
  private failed = false;

  constructor(private db: Db, private bus: Bus, private jobId: string) {}

  /** Starts after events already stored (a job resumed elsewhere never reuses a seq). */
  async init(): Promise<void> {
    const { rows } = await this.db.query<{ seq: number | null }>('SELECT MAX(seq) AS seq FROM job_events WHERE job_id = $1', [this.jobId]);
    this.seq = rows[0]?.seq ?? 0;
  }

  emit(event: JobEvent): void {
    if (event.type === 'usage') return; // Totals are stored on the message instead.
    if (event.type === 'delta') {
      this.pendingText += String(event.text ?? '');
      this.timer ??= setTimeout(() => this.enqueue([]), DELTA_FLUSH_MS);
      return;
    }
    this.enqueue([event]);
  }

  private enqueue(events: JobEvent[]): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const batch: JobEvent[] = [];
    if (this.pendingText) {
      batch.push({ type: 'delta', text: this.pendingText });
      this.pendingText = '';
    }
    batch.push(...events);
    if (batch.length === 0) return;
    this.chain = this.chain.then(() => this.write(batch));
  }

  private async write(batch: JobEvent[]): Promise<void> {
    const first = this.seq + 1;
    this.seq += batch.length;
    try {
      await this.db.query(
        `INSERT INTO job_events (job_id, seq, type, data)
         SELECT $1, * FROM unnest($2::int[], $3::text[], $4::jsonb[])`,
        [this.jobId, batch.map((_, i) => first + i), batch.map((e) => e.type), batch.map((e) => JSON.stringify(e))],
      );
      await this.bus.publish('job_events', { jobId: this.jobId, seq: this.seq });
    } catch (err) {
      if (!this.failed) logger.error(`Could not store events for job ${this.jobId}`, err);
      this.failed = true;
    }
  }

  /** Writes everything still buffered. */
  async flush(): Promise<void> {
    this.enqueue([]);
    await this.chain;
  }
}
