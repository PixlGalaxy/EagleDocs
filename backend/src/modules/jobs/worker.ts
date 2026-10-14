import type { Engine, EngineEvent, ToolCallView } from 'pixlai-engine';
import type { Bus } from '../../bus/bus.js';
import type { EnvConfig } from '../../config/env.js';
import type { Db } from '../../db/pool.js';
import { maybe } from '../../db/pool.js';
import { AppError } from '../../errors.js';
import type { Translate } from '../../i18n/index.js';
import { logger } from '../../logger.js';
import { NODE_OFFLINE_SECONDS } from '../../nodes/nodes.js';
import type { ChatService } from '../chat/chat.service.js';
import type { ModelCatalog } from '../models/catalog.js';
import { JobEventWriter } from './event-writer.js';
import type { CanvasService } from '../canvas/canvas.service.js';
import type { DiskWorkspace } from '../../engine/workspace.js';
import type { AdminEmbeddings } from '../../engine/documents.js';

const POLL_MS = 2000;
const HEARTBEAT_MS = 15_000;
/** Queued jobs prefer the replica named in `preferred_node` for this long (sandbox affinity, phase 4). */
const AFFINITY_SECONDS = 5;

interface JobRow {
  id: string;
  user_id: string;
  chat_id: string | null;
  kind: 'chat' | 'scheduled' | 'sync';
  payload: { model_ref?: string | null };
  cancel_requested: boolean;
}

interface UserRow {
  id: string;
  username: string;
  display_name: string | null;
  language: string;
  timezone: string | null;
  major: string | null;
  institution_name: string | null;
}

export interface WorkerDeps {
  db: Db;
  bus: Bus;
  config: EnvConfig;
  engine: Engine;
  chats: ChatService;
  catalog: ModelCatalog;
  canvas: CanvasService;
  workspace: DiskWorkspace;
  embeddings: AdminEmbeddings;
  t: Translate;
  concurrency: number;
}

/**
 * Runs queued jobs on this replica. Any replica may claim any job (SKIP
 * LOCKED); the browser's stream can be on a different one, since events go
 * through the database. Closing the tab never stops a job.
 */
export class JobWorker {
  private running = new Map<string, AbortController>();
  private wakers = new Set<() => void>();
  private stopped = false;

  constructor(private deps: WorkerDeps) {}

  async start(): Promise<void> {
    const { bus } = this.deps;
    await bus.on('job_queued', () => this.wakeAll());
    await bus.on('job_control', ({ jobId, action }) => {
      if (action === 'cancel') this.running.get(jobId)?.abort(new Error('cancelled'));
    });
    setInterval(() => void this.heartbeat(), HEARTBEAT_MS).unref();
    for (let i = 0; i < this.deps.concurrency; i++) void this.loop();
  }

  stop(): void {
    this.stopped = true;
    for (const controller of this.running.values()) controller.abort(new Error('shutting down'));
    this.wakeAll();
  }

  private wakeAll(): void {
    for (const wake of [...this.wakers]) wake();
  }

  private async loop(): Promise<void> {
    while (!this.stopped) {
      let job: JobRow | undefined;
      try {
        job = await this.claim();
      } catch (err) {
        logger.warn(`Job claim failed: ${(err as Error).message}`);
      }
      if (job) {
        await this.execute(job);
        continue;
      }
      await new Promise<void>((resolve) => {
        const wake = () => {
          clearTimeout(timer);
          this.wakers.delete(wake);
          resolve();
        };
        const timer = setTimeout(wake, POLL_MS);
        this.wakers.add(wake);
      });
    }
  }

  /** One queued job, skipping chats that already have a job in progress (answers stay in order). */
  private claim(): Promise<JobRow | undefined> {
    return maybe<JobRow>(
      this.deps.db,
      `UPDATE jobs SET status = 'running', node_id = $1, started_at = now(), heartbeat_at = now()
       WHERE id = (
         SELECT q.id FROM jobs q
         WHERE q.status = 'queued'
           AND (q.preferred_node IS NULL OR q.preferred_node = $1 OR q.queued_at < now() - make_interval(secs => $2))
           AND NOT EXISTS (SELECT 1 FROM jobs a WHERE a.chat_id = q.chat_id AND a.id <> q.id
                           AND a.status IN ('running', 'waiting_approval', 'waiting_mfa'))
         ORDER BY q.queued_at FOR UPDATE SKIP LOCKED LIMIT 1
       ) RETURNING id, user_id, chat_id, kind, payload, cancel_requested`,
      [this.deps.config.NODE_ID, AFFINITY_SECONDS],
    );
  }

  private async heartbeat(): Promise<void> {
    if (this.running.size === 0) return;
    await this.deps.db
      .query('UPDATE jobs SET heartbeat_at = now() WHERE id = ANY($1::uuid[])', [[...this.running.keys()]])
      .catch((err: Error) => logger.warn(`Job heartbeat failed: ${err.message}`));
  }

  private async finish(jobId: string, status: 'done' | 'failed' | 'cancelled', error?: string): Promise<void> {
    await this.deps.db.query('UPDATE jobs SET status = $2, finished_at = now(), error = $3 WHERE id = $1', [jobId, status, error ?? null]);
  }

  private async execute(job: JobRow): Promise<void> {
    const { db, bus, engine, chats, catalog, t } = this.deps;
    const controller = new AbortController();
    this.running.set(job.id, controller);
    const events = new JobEventWriter(db, bus, job.id);
    await events.init();

    const user = await maybe<UserRow>(
      db,
      `SELECT u.id, u.username, u.display_name, u.language, u.timezone, u.major, i.name AS institution_name
       FROM users u LEFT JOIN institutions i ON i.id = u.institution_id WHERE u.id = $1`,
      [job.user_id],
    );
    const fail = async (message: string) => {
      events.emit({ type: 'error', error: message });
      await events.flush();
      await this.finish(job.id, 'failed', message);
    };

    try {
      if (!user || !job.chat_id) return await fail('This job no longer has a chat or user.');
      if (job.cancel_requested) {
        events.emit({ type: 'status', status: 'cancelled' });
        await events.flush();
        return await this.finish(job.id, 'cancelled');
      }

      const history = await chats.history(job.chat_id);
      const latest = [...history].reverse().find((m) => m.role === 'user')?.content ?? '';
      const historyChars = history.slice(-8).reduce((n, m) => n + m.content.length, 0);

      let resolution;
      try {
        resolution = await catalog.resolve(user.id, job.payload.model_ref ?? null, { text: latest, historyChars });
        if (resolution.isEagleDocs) await catalog.assertQuota(user.id);
      } catch (err) {
        return await fail(err instanceof AppError ? t(err.key, user.language) : (err as Error).message);
      }
      if (resolution.notice) events.emit({ type: 'notice', message: resolution.notice });

      const timezone = user.timezone || 'America/New_York';
      const agent = engine.forUser({
        id: user.id,
        name: user.display_name || user.username,
        language: user.language,
        timezone,
        facts: [
          ...(user.institution_name ? [`Studies at ${user.institution_name}`] : []),
          ...(user.major ? [`Major: ${user.major}`] : []),
        ],
      }, { host: { canvas: { service: this.deps.canvas, userId: user.id, workspace: this.deps.workspace } } });
      // RAG tools compare this with each collection's model.
      await this.deps.embeddings.refresh();

      // The visible answer is the text after the last tool step; kept to save a partial answer if stopped.
      let liveText = '';
      const result = await agent.run({
        runId: job.id,
        model: resolution.model,
        history,
        signal: controller.signal,
        kind: job.kind === 'scheduled' ? 'scheduled' : 'chat',
        sink: {
          emit: (event: EngineEvent) => {
            if (event.type === 'delta') liveText += event.text;
            if (event.type === 'tool_call' || event.type === 'interrupted') liveText = '';
            // The approval card also needs to know its job and state.
            if (event.type === 'approval_required') {
              events.emit({ type: 'approval_required', approval: { ...event.approval, job_id: job.id, status: 'pending' } });
              return;
            }
            events.emit(event as unknown as { type: string });
          },
        },
      });

      const silent = job.kind === 'scheduled' && result.content.trim() === '[SILENT]';
      const status = result.status;
      const finalContent = status === 'done' ? result.content : liveText;
      const produced = status === 'done' ? result.messages.slice(0, -1) : result.messages;
      const message = await chats.saveRun(job.chat_id, {
        jobId: job.id,
        produced,
        final: {
          content: finalContent,
          toolViews: result.toolCalls as ToolCallView[],
          modelRef: resolution.model.ref,
          modelLabel: resolution.model.label,
          tokensIn: result.usage.inputTokens,
          tokensOut: result.usage.outputTokens,
          meta: {
            ...(status === 'cancelled' && { stopped: true }),
            ...(status === 'failed' && { failed: result.error }),
            ...(silent && { silent: true }),
          },
        },
      });
      await catalog.recordUsage(user.id, resolution.isEagleDocs, result.usage.inputTokens, result.usage.outputTokens);

      if (status === 'failed') {
        events.emit({ type: 'error', error: result.error ?? 'The agent failed' });
      } else {
        events.emit({ type: 'done', message });
      }
      await events.flush();
      await this.finish(job.id, status, result.error);
      await this.followUpSteers(job, user.id);
    } catch (err) {
      logger.error(`Job ${job.id} crashed`, err);
      await fail('Something went wrong while answering. Try again.').catch(() => undefined);
    } finally {
      this.running.delete(job.id);
    }
  }

  /** Steers that arrived after the final answer become the next message, so none is lost. */
  private async followUpSteers(job: JobRow, userId: string): Promise<void> {
    const { db, chats, bus } = this.deps;
    const { rows } = await db.query<{ content: string }>(
      `WITH taken AS (UPDATE job_steers SET applied_at = now() WHERE job_id = $1 AND applied_at IS NULL RETURNING content, created_at)
       SELECT content FROM taken ORDER BY created_at`,
      [job.id],
    );
    if (rows.length === 0 || !job.chat_id) return;
    await chats.addUserMessage(db, job.chat_id, rows.map((r) => r.content).join('\n\n'));
    const { rows: created } = await db.query<{ id: string }>(
      "INSERT INTO jobs (user_id, chat_id, kind, payload) VALUES ($1, $2, 'chat', $3) RETURNING id",
      [userId, job.chat_id, job.payload],
    );
    await bus.publish('job_queued', { jobId: created[0]!.id });
  }
}

/** Leader task: jobs whose replica stopped sending heartbeats are marked interrupted. */
export async function reapOrphanJobs(db: Db, bus: Bus): Promise<void> {
  const { rows } = await db.query<{ id: string }>(
    `UPDATE jobs SET status = 'interrupted', finished_at = now(), error = 'The server running this job stopped'
     WHERE status IN ('running', 'waiting_approval', 'waiting_mfa') AND heartbeat_at < now() - make_interval(secs => $1)
     RETURNING id`,
    [NODE_OFFLINE_SECONDS],
  );
  for (const { id } of rows) {
    const writer = new JobEventWriter(db, bus, id);
    await writer.init();
    writer.emit({ type: 'error', error: 'The server working on this answer restarted. Send your message again.' });
    await writer.flush();
    logger.warn(`Job ${id} interrupted: its node stopped`);
  }
}

/** Leader task: events of finished jobs are only needed for reconnects shortly after. */
export async function pruneJobEvents(db: Db): Promise<void> {
  await db.query(
    `DELETE FROM job_events e USING jobs j WHERE e.job_id = j.id AND j.finished_at < now() - interval '24 hours'`,
  );
}
