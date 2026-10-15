import { Router } from 'express';
import type { Bus } from '../../bus/bus.js';
import type { Db } from '../../db/pool.js';
import { many, maybe, one } from '../../db/pool.js';
import { withTx } from '../../db/tx.js';
import { badRequest, conflict, notFound, tooManyRequests } from '../../errors.js';
import { routeParam } from '../../route-params.js';
import type { AppRequest } from '../../types/index.js';
import { requireAuth } from '../auth/session.middleware.js';
import { titleFrom, type ChatService } from './chat.service.js';
import type { DiskWorkspace } from '../../engine/workspace.js';
import { intoChatFolder, resolveAttachments } from './attachments.js';
import { compactHistory, estimateTokens, type ReasoningLevel } from 'pixlai-engine';
import type { ModelCatalog } from '../models/catalog.js';
import { hitRateLimit } from '../../middleware/rate-limit.js';
import type { Queryable } from '../../db/pool.js';

/** "connection:<id>:<model>" or "eagledocs:<tier>": short; anything longer is not a model. */
const MAX_MODEL_REF = 200;
const modelRefOf = (value: unknown): string | null => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > MAX_MODEL_REF) throw badRequest('error.invalidInput');
  return value;
};

/**
 * Inside the transaction that queues a job: locks the chat row so two sends at
 * the same moment cannot both start a job in it.
 */
async function assertChatIdle(client: Queryable, chatId: string): Promise<void> {
  await client.query('SELECT id FROM chats WHERE id = $1 FOR UPDATE', [chatId]);
  const { rows } = await client.query(
    `SELECT 1 FROM jobs WHERE chat_id = $1 AND status IN ('queued', 'running', 'waiting_approval', 'waiting_mfa') LIMIT 1`,
    [chatId],
  );
  if (rows.length) throw conflict('chat.busy');
}

const REASONING: ReasoningLevel[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'];

const MAX_MESSAGE_CHARS = 20_000;
const MAX_STEER_CHARS = 2000;
const MAX_PENDING_STEERS = 5;
const ACTIVE = ['queued', 'running', 'waiting_approval', 'waiting_mfa'];
const UUID = /^[0-9a-f-]{36}$/i;

function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim()) throw badRequest('chat.emptyMessage');
  if (value.length > max) throw badRequest('chat.messageTooLong');
  return value.trim();
}

export function createChatRoutes(db: Db, bus: Bus, chats: ChatService, workspace: DiskWorkspace, catalog: ModelCatalog) {
  const chatsRouter = Router();
  const jobsRouter = Router();
  const approvalsRouter = Router();
  chatsRouter.use(requireAuth);
  jobsRouter.use(requireAuth);
  approvalsRouter.use(requireAuth);

  // ---------------------------------------------------------------- chats

  chatsRouter.get('/', async (req: AppRequest, res) => {
    res.json(await chats.list(req.user!.id));
  });

  chatsRouter.post('/', async (req: AppRequest, res) => {
    const body = (req.body ?? {}) as { title?: unknown; model_ref?: unknown };
    const chat = await chats.create(
      req.user!.id,
      typeof body.title === 'string' ? body.title.trim() : '',
      modelRefOf(body.model_ref),
    );
    res.status(201).json({ ...chat, active_job_id: null });
  });

  chatsRouter.get('/:id', async (req: AppRequest, res) => {
    const chat = await chats.get(req.user!.id, routeParam(req.params.id));
    res.json({
      chat,
      messages: await chats.visibleMessages(chat.id),
      pending_approvals: await chats.pendingApprovals(chat.id),
      background_jobs: await chats.backgroundJobs(chat.id),
      context: await chats.lastContext(chat.id),
    });
  });

  /**
   * A page the agent showed (show_html), as its own document. Its CSP makes it a
   * sandbox with an opaque origin (no cookies, no app, no storage) and no
   * network at all, so a page can only draw and compute, never send data away.
   */
  chatsRouter.get('/:id/messages/:messageId/displays/:n', async (req: AppRequest, res) => {
    const display = await chats.display(req.user!.id, routeParam(req.params.id), routeParam(req.params.messageId), Number(req.params.n));
    if (!display || display.kind !== 'html') throw notFound();
    res.setHeader(
      'Content-Security-Policy',
      "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'",
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.type('html').send(display.content);
  });

  chatsRouter.patch('/:id', async (req: AppRequest, res) => {
    const title = text((req.body as { title?: unknown })?.title, 120);
    await chats.rename(req.user!.id, routeParam(req.params.id), title);
    res.json(await chats.get(req.user!.id, routeParam(req.params.id)));
  });

  chatsRouter.delete('/:id', async (req: AppRequest, res) => {
    await chats.remove(req.user!.id, routeParam(req.params.id));
    res.status(204).end();
  });

  /** Saves the message and queues the job; the answer arrives through /stream. */
  chatsRouter.post('/:id/messages', async (req: AppRequest, res) => {
    const userId = req.user!.id;
    const chat = await chats.get(userId, routeParam(req.params.id));
    if (chat.active_job_id) throw conflict('chat.busy');
    const body = (req.body ?? {}) as { content?: unknown; model_ref?: unknown; attachments?: unknown; reasoning?: unknown };
    // 'default' or nothing: the provider's own default.
    const reasoning = REASONING.includes(body.reasoning as ReasoningLevel) ? (body.reasoning as ReasoningLevel) : undefined;
    const picked = await resolveAttachments(workspace, userId, body.attachments);
    // A picture alone is a valid message.
    const content = picked.length && (typeof body.content !== 'string' || !body.content.trim()) ? '' : text(body.content, MAX_MESSAGE_CHARS);
    // Uploads land in this chat's folder (named after its first message in a new chat).
    const attachments = picked.length
      ? await intoChatFolder(workspace, userId, picked, await chats.folderOf(userId, chat.id, titleFrom(content || picked.map((a) => a.name).join(', '))))
      : picked;
    const modelRef = modelRefOf(body.model_ref);

    const { message, jobId } = await withTx(db, async (client) => {
      await assertChatIdle(client, chat.id);
      const msg = await chats.addUserMessage(client, chat.id, content, attachments.length ? { attachments } : {});
      await client.query(
        "UPDATE chats SET model_ref = $2, title = CASE WHEN title = '' THEN $3 ELSE title END WHERE id = $1",
        [chat.id, modelRef, titleFrom(content || attachments.map((a) => a.name).join(', '))],
      );
      const { rows } = await client.query<{ id: string }>(
        "INSERT INTO jobs (user_id, chat_id, kind, payload) VALUES ($1, $2, 'chat', $3) RETURNING id",
        [userId, chat.id, { model_ref: modelRef, ...(reasoning && { reasoning }) }],
      );
      return { message: msg, jobId: rows[0]!.id };
    });
    await bus.publish('job_queued', { jobId });
    res.status(201).json({ job_id: jobId, message });
  });

  /**
   * "Compact" from the context ring: the model summarizes the older messages and
   * the summary replaces them in what it reads from now on. The chat the
   * student sees does not change.
   */
  chatsRouter.post('/:id/compact', async (req: AppRequest, res) => {
    const userId = req.user!.id;
    const chat = await chats.get(userId, routeParam(req.params.id));
    if (chat.active_job_id) throw conflict('chat.busy');
    // A summary is a full-context model call: one at a time per chat, and a few per hour.
    const once = await hitRateLimit(db, `compact:chat:${chat.id}`, 60_000, 1);
    const hourly = await hitRateLimit(db, `compact:user:${userId}`, 60 * 60_000, 20);
    if (!once.allowed || !hourly.allowed) throw tooManyRequests(Math.max(once.allowed ? 0 : once.retryAfterSeconds, hourly.allowed ? 0 : hourly.retryAfterSeconds));
    const rows = await chats.historyRows(chat.id);
    const history = rows.map((r) => {
      const { attachments: _files, ...message } = r.message;
      return message;
    });
    const resolution = await catalog.resolve(userId, chat.model_ref, { text: '', historyChars: 0 });
    if (resolution.isEagleDocs) await catalog.assertQuota(userId);
    const result = await compactHistory(history, resolution.model, AbortSignal.timeout(120_000));
    // Counts toward the daily limit like any message (estimated: the summary call reports no usage here).
    if (result) await catalog.recordUsage(userId, resolution.isEagleDocs, estimateTokens(history.slice(0, result.keepFrom)), estimateTokens([{ role: 'user', content: result.summary }]));
    const before = await chats.lastContext(chat.id);
    if (!result) {
      res.json({ summarized: 0, context: before });
      return;
    }
    const kept = history.slice(result.keepFrom);
    // The system prompt and tools are not in the history: keep their share from the last measurement.
    const saved = estimateTokens(history) - estimateTokens([{ role: 'user', content: result.summary }, ...kept]);
    const context = { used: Math.max(0, (before?.used ?? estimateTokens(history)) - saved), window: before?.window ?? resolution.model.contextWindow };
    await chats.saveSummary(chat.id, result.summary, rows[result.keepFrom - 1]!.seq, context);
    res.json({ summarized: result.keepFrom, context });
  });

  /**
   * Server-sent events for one job, replayed from the database: the job can
   * run on another replica, and a reconnect (Last-Event-ID) resumes exactly
   * where it stopped. Ends after `done` or `error`.
   */
  chatsRouter.get('/:id/stream', async (req: AppRequest, res) => {
    const userId = req.user!.id;
    const chat = await chats.get(userId, routeParam(req.params.id));
    const jobId = typeof req.query.job === 'string' ? req.query.job : '';
    if (!UUID.test(jobId)) throw notFound();
    // Background helper jobs keep their chat in the payload.
    const job = await maybe<{ status: string }>(
      db,
      "SELECT status FROM jobs WHERE id = $1 AND (chat_id = $2 OR payload->>'chat_id' = $2::text) AND user_id = $3",
      [jobId, chat.id, userId],
    );
    if (!job) throw notFound();

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');

    let last = Number(req.get('last-event-id') ?? 0) || 0;
    let closed = false;
    let busy = false;
    let again = false;

    if (job.status === 'queued' && last === 0) {
      const position = await one<{ n: number }>(
        db,
        "SELECT COUNT(*) AS n FROM jobs WHERE status = 'queued' AND queued_at <= (SELECT queued_at FROM jobs WHERE id = $1)",
        [jobId],
      );
      res.write(`data: ${JSON.stringify({ type: 'status', status: 'queued', queue_position: position.n })}\n\n`);
    }

    const pump = async () => {
      if (closed) return;
      if (busy) {
        again = true;
        return;
      }
      busy = true;
      try {
        do {
          again = false;
          const rows = await many<{ seq: number; data: { type: string } }>(
            db,
            'SELECT seq, data FROM job_events WHERE job_id = $1 AND seq > $2 ORDER BY seq LIMIT 500',
            [jobId, last],
          );
          for (const row of rows) {
            if (closed) return;
            res.write(`id: ${row.seq}\ndata: ${JSON.stringify(row.data)}\n\n`);
            last = row.seq;
            if (row.data.type === 'done' || row.data.type === 'error') {
              cleanup();
              res.end();
              return;
            }
          }
          if (rows.length === 500) again = true;
        } while (again && !closed);
      } catch {
        // A DB blip: the next notification or poll retries.
      } finally {
        busy = false;
      }
    };

    const unsubscribe = await bus.on('job_events', (event) => {
      if (event.jobId === jobId) void pump();
    });
    // Covers a notification lost while the bus reconnected.
    const poll = setInterval(() => void pump(), 5000);
    // While someone follows the job, finishing it needs no push (the worker checks watched_at).
    const watch = () => void db.query('UPDATE jobs SET watched_at = now() WHERE id = $1', [jobId]).catch(() => undefined);
    watch();
    const heartbeat = setInterval(() => {
      res.write(': ping\n\n');
      watch();
    }, 20_000);
    const cleanup = () => {
      closed = true;
      unsubscribe();
      clearInterval(poll);
      clearInterval(heartbeat);
    };
    req.on('close', cleanup);
    void pump();
  });

  // ---------------------------------------------------------------- jobs

  const ownJob = async (req: AppRequest) => {
    const id = routeParam(req.params.id);
    if (!UUID.test(id)) throw notFound();
    const job = await maybe<{ id: string; status: string; chat_id: string | null }>(
      db,
      'SELECT id, status, chat_id FROM jobs WHERE id = $1 AND user_id = $2',
      [id, req.user!.id],
    );
    if (!job) throw notFound();
    return job;
  };

  jobsRouter.get('/', async (req: AppRequest, res) => {
    res.json(
      await many(
        db,
        `SELECT j.id, c.id AS chat_id, c.title AS chat_title, j.kind, j.status, j.queued_at, j.started_at, j.finished_at, j.error
         FROM jobs j LEFT JOIN chats c ON c.id = COALESCE(j.chat_id, (j.payload->>'chat_id')::uuid) WHERE j.user_id = $1 ORDER BY j.queued_at DESC LIMIT 50`,
        [req.user!.id],
      ),
    );
  });

  /** Runs a stopped turn again (its replica died or it failed) without the student retyping it. */
  jobsRouter.post('/:id/retry', async (req: AppRequest, res) => {
    const job = await ownJob(req);
    const row = await maybe<{ kind: string; payload: Record<string, unknown> }>(db, 'SELECT kind, payload FROM jobs WHERE id = $1', [job.id]);
    if (!job.chat_id || !row || !['chat', 'scheduled'].includes(row.kind) || !['interrupted', 'failed'].includes(job.status)) {
      throw conflict('chat.notRetryable');
    }
    const chat = await chats.get(req.user!.id, job.chat_id);
    if (chat.active_job_id) throw conflict('chat.busy');
    const jobId = await withTx(db, async (client) => {
      await assertChatIdle(client, job.chat_id!);
      // Hidden from the chat, read by the model: the history must end with something to answer.
      await chats.addUserMessage(client, job.chat_id!, '[The previous attempt stopped before it finished. Continue the task where it left off.]', { internal: true, retry_of: job.id });
      const { rows } = await client.query<{ id: string }>(
        "INSERT INTO jobs (user_id, chat_id, kind, payload) VALUES ($1, $2, 'chat', $3) RETURNING id",
        [req.user!.id, job.chat_id, { model_ref: row.payload.model_ref ?? null }],
      );
      return rows[0]!.id;
    });
    await bus.publish('job_queued', { jobId });
    res.status(201).json({ job_id: jobId, chat_id: job.chat_id });
  });

  jobsRouter.post('/:id/cancel', async (req: AppRequest, res) => {
    const job = await ownJob(req);
    if (job.status === 'queued') {
      const result = await db.query("UPDATE jobs SET status = 'cancelled', finished_at = now() WHERE id = $1 AND status = 'queued'", [job.id]);
      if (result.rowCount) {
        await db.query(
          `INSERT INTO job_events (job_id, seq, type, data)
           VALUES ($1, COALESCE((SELECT MAX(seq) FROM job_events WHERE job_id = $1), 0) + 1, 'error', $2)`,
          [job.id, { type: 'error', error: 'Stopped' }],
        );
        await bus.publish('job_events', { jobId: job.id, seq: 0 });
      }
    } else if (ACTIVE.includes(job.status)) {
      await db.query('UPDATE jobs SET cancel_requested = true WHERE id = $1', [job.id]);
      await bus.publish('job_control', { jobId: job.id, action: 'cancel' });
    }
    res.status(204).end();
  });

  /** A correction while the agent works. Applied at its next safe point, on whichever replica runs it. */
  jobsRouter.post('/:id/steer', async (req: AppRequest, res) => {
    const job = await ownJob(req);
    if (!ACTIVE.includes(job.status)) throw conflict('chat.notRunning');
    const content = text((req.body as { content?: unknown })?.content, MAX_STEER_CHARS);
    const pending = await one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM job_steers WHERE job_id = $1 AND applied_at IS NULL', [job.id]);
    if (pending.n >= MAX_PENDING_STEERS) throw conflict('chat.tooManySteers');
    const { rows } = await db.query<{ id: string; content: string; created_at: Date }>(
      'INSERT INTO job_steers (job_id, content) VALUES ($1, $2) RETURNING id, content, created_at',
      [job.id, content],
    );
    await bus.publish('job_control', { jobId: job.id, action: 'steer' });
    res.status(201).json(rows[0]);
  });

  // ---------------------------------------------------------------- approvals

  approvalsRouter.post('/:id/:decision', async (req: AppRequest, res) => {
    const id = routeParam(req.params.id);
    const decision = routeParam(req.params.decision);
    if (!UUID.test(id) || (decision !== 'approve' && decision !== 'reject')) throw notFound();
    const row = await maybe<{ job_id: string }>(
      db,
      `UPDATE approvals SET status = $3, decided_at = now() WHERE id = $1 AND user_id = $2 AND status = 'pending' RETURNING job_id`,
      [id, req.user!.id, decision === 'approve' ? 'approved' : 'rejected'],
    );
    if (!row) throw notFound();
    await bus.publish('job_control', { jobId: row.job_id, action: 'approval' });
    res.status(204).end();
  });

  return { chatsRouter, jobsRouter, approvalsRouter };
}
