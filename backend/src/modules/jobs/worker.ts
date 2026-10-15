import { backgroundReportMessage, type DelegateReport, type DelegateTask, type Engine, type EngineEvent, type ReasoningLevel, type ToolCallView } from 'pixlai-engine';
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
import type { SchoolService } from '../school/school.service.js';
import type { PushService } from '../push/push.service.js';
import type { BuiltinSkills } from '../skills/builtin.js';
import type { CourseFolders } from '../canvas/course-folders.js';
import type { TiersService } from '../billing/tiers.service.js';
import { withAttachments } from '../chat/attachments.js';

const POLL_MS = 2000;
const HEARTBEAT_MS = 15_000;
/** Queued jobs prefer the replica named in `preferred_node` for this long (sandbox affinity, phase 4). */
const AFFINITY_SECONDS = 5;
/** Background helper jobs per chat at once. */
const MAX_BACKGROUND_PER_CHAT = 2;

/** A helper's event as the student would see it (helpers can hit Duo too). */
function innermost(event: EngineEvent): EngineEvent {
  let inner = event;
  while (inner.type === 'subagent') inner = inner.event;
  return inner;
}

/** Markdown reduced to a notification line. */
function preview(text: string, max = 140): string {
  const plain = text.replace(/[#*_`>|]/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim();
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
}

/** Helper agents' tokens and usage would be one stored event each: only their steps are worth showing. */
function isNoise(event: EngineEvent): boolean {
  let inner: EngineEvent = event;
  while (inner.type === 'subagent') inner = inner.event;
  return inner !== event && (inner.type === 'delta' || inner.type === 'usage');
}

interface JobRow {
  id: string;
  user_id: string;
  chat_id: string | null;
  kind: 'chat' | 'scheduled' | 'sync' | 'delegate';
  payload: {
    model_ref?: string | null;
    /** delegate jobs: their chat (kept out of chat_id so the chat stays free) and tasks. */
    chat_id?: string;
    tasks?: DelegateTask[];
    /** delegate jobs, once finished: what the helpers reported. */
    reports?: DelegateReport[];
    /** A chat turn that answers with the reports of this delegate job. */
    background_job_id?: string;
    /** How hard the model thinks for this message (the composer's Thinking selector). */
    reasoning?: ReasoningLevel;
  };
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
  school: SchoolService;
  push: PushService;
  builtinSkills: BuiltinSkills;
  courseFolders: CourseFolders;
  tiers: TiersService;
  t: Translate;
  concurrency: number;
}

/** The run note that points the agent at its chat's folder. */
function chatFolderNote(folder: string): string {
  return [
    "## This chat's files",
    `This chat's folder in the workspace is "${folder}/". Save the files you create for this chat there (for example`,
    `"${folder}/summary.md"), unless the user asks for another place. Files the user attaches in this chat are there too.`,
  ].join('\n');
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

  /** One queued job, skipping chats that already have a job in progress (answers stay in order) and students at their limit. */
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
           -- Each plan allows some jobs at once; more wait in the queue.
           AND (SELECT COUNT(*) FROM jobs u WHERE u.user_id = q.user_id
                AND u.status IN ('running', 'waiting_approval', 'waiting_mfa'))
               < COALESCE((SELECT t.max_background_jobs FROM tiers t WHERE t.id = effective_tier(q.user_id)), 2)
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

  private async planLimits(userId: string) {
    const plan = await this.deps.tiers.limitsFor(userId);
    return { maxParallelSubagents: plan.maxParallelSubagents, maxSubagentDepth: plan.maxSubagentDepth, maxSchedules: plan.maxSchedules };
  }

  /** A browser follows this job's stream right now (its SSE heartbeat keeps watched_at fresh). */
  private async watched(jobId: string): Promise<boolean> {
    const { rowCount } = await this.deps.db.query("SELECT 1 FROM jobs WHERE id = $1 AND watched_at > now() - interval '45 seconds'", [jobId]);
    return Boolean(rowCount);
  }

  /**
   * Push for what needs the student: Duo always (the phone is needed anyway),
   * approvals only when nobody is looking at the chat.
   */
  private pushFor(event: EngineEvent, job: JobRow, chatId: string, user: UserRow): void {
    const { push, t } = this.deps;
    const inner = innermost(event);
    const url = `/chat/${chatId}`;
    if (inner.type === 'mfa_required') {
      void push.notify(user.id, { kind: 'mfa_required', title: t('pushMsg.mfaTitle', user.language), body: inner.message, url, tag: `mfa-${job.id}` });
    } else if (inner.type === 'approval_required') {
      void this.watched(job.id).then(async (seen) => {
        if (!seen)
          await push.notify(user.id, { kind: 'approval_required', title: t('pushMsg.approvalTitle', user.language), body: inner.approval.summary, url, tag: `approval-${inner.approval.id}` });
      });
    }
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
      const chatId = job.kind === 'delegate' ? (job.payload.chat_id ?? null) : job.chat_id;
      if (!user || !chatId) return await fail('This job no longer has a chat or user.');
      if (job.cancel_requested) {
        events.emit({ type: 'status', status: 'cancelled' });
        await events.flush();
        return await this.finish(job.id, 'cancelled');
      }

      // Reports of background helpers enter the chat now that it is free, so the history stays in order.
      if (job.payload.background_job_id) {
        const background = await this.backgroundReports(job.payload.background_job_id, chatId);
        if (background) events.emit({ type: 'background_results', message: background });
      }

      const tasks = job.kind === 'delegate' ? (job.payload.tasks ?? []) : [];
      const history = job.kind === 'delegate' ? [] : await withAttachments(this.deps.workspace, user.id, await chats.history(chatId));
      const latest =
        job.kind === 'delegate' ? tasks.map((task) => task.goal).join('\n') : ([...history].reverse().find((m) => m.role === 'user')?.content ?? '');
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
      // Where this chat keeps its files: the agent and its helpers save there.
      const notes = chatId ? chatFolderNote(await chats.folderOf(user.id, chatId)) : undefined;
      const agent = engine.forUser({
        id: user.id,
        name: user.display_name || user.username,
        language: user.language,
        timezone,
        facts: [
          ...(user.institution_name ? [`Studies at ${user.institution_name}`] : []),
          ...(user.major ? [`Major: ${user.major}`] : []),
        ],
      }, {
        // The plan decides how many helpers, how deep, and how many schedules.
        limits: await this.planLimits(user.id),
        host: {
          canvas: { service: this.deps.canvas, userId: user.id, workspace: this.deps.workspace, folders: this.deps.courseFolders },
          school: { service: this.deps.school, userId: user.id, workspace: this.deps.workspace },
        },
      });
      // RAG tools compare this with each collection's model.
      await this.deps.embeddings.refresh();
      // The agent can match each helper to a model the user has (fast for lookups, smart for analysis).
      const helperModels = await catalog.helperModels(user.id, resolution.model.ref);
      // Email or Degree Works tools only where the institution offers them and has not switched them off.
      const hidden = await this.deps.builtinSkills.hiddenTools(user.id);
      const toolFilter = (tool: { name: string }) => !hidden(tool.name);

      if (job.kind === 'delegate') {
        const { reports, usage } = await agent.runSubagents({
          runId: job.id,
          notes,
          model: resolution.model,
          tasks,
          helperModels,
          toolFilter,
          signal: controller.signal,
          sink: {
            emit: (event: EngineEvent) => {
              if (isNoise(event)) return;
              this.pushFor(event, job, chatId, user);
              events.emit(event as unknown as { type: string });
            },
          },
        });
        await catalog.recordUsage(user.id, resolution.isEagleDocs, usage.inputTokens, usage.outputTokens);
        if (controller.signal.aborted) {
          events.emit({ type: 'error', error: 'Stopped' });
          await events.flush();
          return await this.finish(job.id, 'cancelled');
        }
        await this.answerWithReports(job, chatId, reports);
        events.emit({ type: 'done' });
        await events.flush();
        return await this.finish(job.id, 'done');
      }

      // The visible answer is the text after the last tool step; kept to save a partial answer if stopped.
      let liveText = '';
      // The last context estimate, kept on the answer for the composer's meter.
      let context: { used: number; window: number } | undefined;
      const result = await agent.run({
        runId: job.id,
        notes,
        model: resolution.model,
        history,
        signal: controller.signal,
        kind: job.kind === 'scheduled' ? 'scheduled' : 'chat',
        ...(job.payload.reasoning && { reasoning: job.payload.reasoning }),
        helperModels,
        toolFilter,
        ...(job.kind === 'chat' && { startBackground: (list: DelegateTask[]) => this.queueBackground(job, chatId, user.id, list) }),
        sink: {
          emit: (event: EngineEvent) => {
            if (isNoise(event)) return;
            this.pushFor(event, job, chatId, user);
            if (event.type === 'context') context = { used: event.used, window: event.window };
            if (event.type === 'delta') liveText += event.text;
            if (event.type === 'tool_call' || event.type === 'interrupted') liveText = '';
            // Waiting on the student's phone (Duo) or back to work: the job row shows it (Admin, Chats list).
            if (event.type === 'status' && (event.status === 'waiting_mfa' || event.status === 'running')) {
              void this.deps.db
                .query(`UPDATE jobs SET status = $2 WHERE id = $1 AND status IN ('running', 'waiting_mfa')`, [job.id, event.status])
                .catch(() => undefined);
            }
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
      const message = await chats.saveRun(chatId, {
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
            ...(context && { context }),
            // ask_user with options: the chat shows them as choices under the answer.
            ...(result.questions && { questions: result.questions }),
            // show_html pages, served one by one from /chats/:id/messages/:mid/displays/:n.
            ...(result.displays?.length && { displays: result.displays }),
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
      // Done while the student was away (app closed, another chat): tell them.
      if ((status === 'done' || status === 'failed') && !silent && !(await this.watched(job.id))) {
        const chat = await maybe<{ title: string }>(db, 'SELECT title FROM chats WHERE id = $1', [chatId]);
        void this.deps.push.notify(user.id, {
          kind: 'job_done',
          title: status === 'done' ? chat?.title || t('pushMsg.doneTitle', user.language) : t('pushMsg.failedTitle', user.language),
          body: preview(status === 'done' ? finalContent : (result.error ?? '')),
          url: `/chat/${chatId}`,
          tag: `chat-${chatId}`,
        });
      }
      await this.followUpSteers(job, user.id);
    } catch (err) {
      logger.error(`Job ${job.id} crashed`, err);
      await fail('Something went wrong while answering. Try again.').catch(() => undefined);
    } finally {
      this.running.delete(job.id);
    }
  }

  /** agent_delegate(background): the helpers run as their own job, next to the chat instead of in it. */
  private async queueBackground(job: JobRow, chatId: string, userId: string, tasks: DelegateTask[]): Promise<void> {
    const { db, bus } = this.deps;
    const { rows } = await db.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM jobs WHERE kind = 'delegate' AND payload->>'chat_id' = $1 AND status IN ('queued', 'running')`,
      [chatId],
    );
    if ((rows[0]?.n ?? 0) >= MAX_BACKGROUND_PER_CHAT) {
      throw new Error(`${MAX_BACKGROUND_PER_CHAT} background tasks are already running in this chat: wait for them or delegate without background`);
    }
    const { rows: created } = await db.query<{ id: string }>(
      "INSERT INTO jobs (user_id, kind, payload) VALUES ($1, 'delegate', $2) RETURNING id",
      [userId, { chat_id: chatId, tasks, model_ref: job.payload.model_ref ?? null, parent_job_id: job.id }],
    );
    await bus.publish('job_queued', { jobId: created[0]!.id });
  }

  /** Keeps the reports on the delegate job and queues the chat turn that answers with them. */
  private async answerWithReports(job: JobRow, chatId: string, reports: DelegateReport[]): Promise<void> {
    const { db, bus } = this.deps;
    await db.query(`UPDATE jobs SET payload = payload || jsonb_build_object('reports', $2::jsonb) WHERE id = $1`, [job.id, JSON.stringify(reports)]);
    const { rows } = await db.query<{ id: string }>(
      "INSERT INTO jobs (user_id, chat_id, kind, payload) VALUES ($1, $2, 'chat', $3) RETURNING id",
      [job.user_id, chatId, { model_ref: job.payload.model_ref ?? null, background_job_id: job.id }],
    );
    await bus.publish('job_queued', { jobId: rows[0]!.id });
  }

  /** Stores the reports of a finished delegate job in its chat, once. */
  private async backgroundReports(delegateJobId: string, chatId: string) {
    const { db, chats } = this.deps;
    const taken = await maybe<{ reports: DelegateReport[] }>(
      db,
      `UPDATE jobs SET payload = payload || '{"reported": true}'::jsonb
       WHERE id = $1 AND kind = 'delegate' AND payload ? 'reports' AND NOT payload ? 'reported'
       RETURNING payload->'reports' AS reports`,
      [delegateJobId],
    );
    if (!taken) return null;
    return chats.addUserMessage(db, chatId, backgroundReportMessage(taken.reports), {
      background: { job_id: delegateJobId, tasks: taken.reports.map((r) => ({ goal: r.goal, status: r.status })) },
    });
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

/** A job with no heartbeat (every 15 s) for this long lost its replica. With the reaper every 10 s, the user knows within a minute. */
export const JOB_ORPHAN_SECONDS = 40;

/** Leader task: jobs whose replica stopped sending heartbeats are marked interrupted. */
export async function reapOrphanJobs(db: Db, bus: Bus): Promise<void> {
  const { rows } = await db.query<{ id: string }>(
    `UPDATE jobs SET status = 'interrupted', finished_at = now(), error = 'The server running this job stopped'
     WHERE status IN ('running', 'waiting_approval', 'waiting_mfa') AND heartbeat_at < now() - make_interval(secs => $1)
     RETURNING id`,
    [JOB_ORPHAN_SECONDS],
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
