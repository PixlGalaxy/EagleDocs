import { nextRun, parseSchedule } from 'pixlai-engine';
import type { Bus } from '../../bus/bus.js';
import type { Db } from '../../db/pool.js';
import { withTx } from '../../db/tx.js';
import { logger } from '../../logger.js';

interface DueRow {
  id: string;
  user_id: string;
  name: string;
  schedule: string;
  timezone: string;
  prompt: string;
  model_ref: string | null;
  chat_id: string | null;
}

/**
 * Leader task, every minute: queues a run for each schedule that is due. The
 * next run time is saved in the same transaction, before the job exists, so a
 * crash can skip a run but never double it. Each schedule writes into its own
 * chat, so the user finds every report in one place.
 */
export async function runDueSchedules(db: Db, bus: Bus): Promise<void> {
  const queued: string[] = [];
  await withTx(db, async (client) => {
    const { rows } = await client.query<DueRow>(
      `SELECT s.id, s.user_id, s.name, s.schedule, s.timezone, s.prompt, s.model_ref, s.chat_id
       FROM schedules s JOIN users u ON u.id = s.user_id
       WHERE s.enabled AND s.next_run_at <= now() AND u.status = 'active'
       ORDER BY s.next_run_at LIMIT 50 FOR UPDATE OF s SKIP LOCKED`,
    );
    const now = new Date();
    for (const due of rows) {
      let next: Date | null = null;
      try {
        next = nextRun(parseSchedule(due.schedule), due.timezone, now, now);
      } catch (err) {
        logger.warn(`Schedule ${due.id} is invalid and was disabled: ${(err as Error).message}`);
      }
      await client.query('UPDATE schedules SET last_run_at = now(), next_run_at = $2, enabled = $3 WHERE id = $1', [
        due.id,
        next,
        next !== null,
      ]);

      let chatId = due.chat_id;
      if (!chatId) {
        const { rows: chat } = await client.query<{ id: string }>(
          "INSERT INTO chats (user_id, title, model_ref, kind) VALUES ($1, $2, $3, 'scheduled') RETURNING id",
          [due.user_id, due.name, due.model_ref],
        );
        chatId = chat[0]!.id;
        await client.query('UPDATE schedules SET chat_id = $2 WHERE id = $1', [due.id, chatId]);
      }
      await client.query("INSERT INTO messages (chat_id, role, content, meta) VALUES ($1, 'user', $2, $3)", [
        chatId,
        due.prompt,
        { schedule_id: due.id },
      ]);
      const { rows: job } = await client.query<{ id: string }>(
        "INSERT INTO jobs (user_id, chat_id, kind, payload) VALUES ($1, $2, 'scheduled', $3) RETURNING id",
        [due.user_id, chatId, { model_ref: due.model_ref, schedule_id: due.id }],
      );
      queued.push(job[0]!.id);
    }
  });
  for (const jobId of queued) await bus.publish('job_queued', { jobId });
  if (queued.length) logger.info(`Queued ${queued.length} scheduled run(s)`);
}
