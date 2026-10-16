import type { ChatMessage, Display, ToolCallRequest, ToolCallView, UserQuestion } from 'pixlai-engine';
import type { Db, Queryable } from '../../db/pool.js';
import { many, maybe } from '../../db/pool.js';
import { conflict, notFound } from '../../errors.js';
import { withTx } from '../../db/tx.js';
import type { Attachment } from './attachments.js';

export interface ChatRow {
  id: string;
  user_id: string;
  title: string;
  model_ref: string | null;
  kind: 'chat' | 'scheduled';
  created_at: Date;
  updated_at: Date;
}

interface MessageRow {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls: ToolCallRequest[] | null;
  tool_call_id: string | null;
  tool_name: string | null;
  meta: {
    steer?: boolean;
    internal?: boolean;
    tool_views?: ToolCallView[];
    stopped?: boolean;
    failed?: string;
    silent?: boolean;
    background?: BackgroundInfo;
    attachments?: Attachment[];
    /** Final answers: estimated prompt tokens of the last model call, and the window. */
    context?: { used: number; window: number };
    /** The agent asked with options (ask_user). */
    questions?: UserQuestion[];
    /** Pages the agent showed (show_html). */
    displays?: Display[];
    /** An edited message: which edit it belongs to, and which of its versions this is. */
    version_group?: string;
    version?: number;
  };
  model_ref: string | null;
  model_label: string | null;
  created_at: Date;
}

/** frontend/src/api/types.ts `Message` */
export interface MessageView {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  model_ref: string | null;
  model_label: string | null;
  tool_calls: ToolCallView[];
  steer?: boolean;
  /** Reports of helper agents that worked in the background (shown as a card, not as the user's words). */
  background?: BackgroundInfo;
  /** Files and pictures the student attached (workspace paths). */
  attachments?: Attachment[];
  /** Questions with options the agent asked; the student answers with the next message. */
  questions?: UserQuestion[];
  /** Pages the agent showed, by title; each loads from its own URL (the HTML is never inlined here). */
  displays?: { kind: Display['kind']; title: string }[];
  /** The answer stopped on an error: why (shown under it, so a reload still tells the student). */
  failed?: string;
  /** An edited message of the student: this is version `version` of `versions` (the route fills `versions`). */
  version_group?: string;
  version?: number;
  versions?: number;
  created_at: Date;
}

export interface BackgroundInfo {
  job_id: string;
  tasks: { goal: string; status: string }[];
}

const UUID = /^[0-9a-f-]{36}$/i;

export function toMessageView(row: MessageRow): MessageView {
  return {
    id: row.id,
    role: row.role === 'user' ? 'user' : 'assistant',
    content: row.content,
    model_ref: row.model_ref,
    model_label: row.model_label,
    tool_calls: row.meta.tool_views ?? [],
    ...(row.meta.steer && { steer: true }),
    ...(row.meta.background && { background: row.meta.background }),
    ...(row.meta.attachments?.length && { attachments: row.meta.attachments }),
    ...(row.meta.questions?.length && { questions: row.meta.questions }),
    ...(row.meta.failed && { failed: row.meta.failed }),
    ...(row.meta.displays?.length && { displays: row.meta.displays.map((d) => ({ kind: d.kind, title: d.title })) }),
    ...(row.meta.version_group && { version_group: row.meta.version_group, version: row.meta.version ?? 1 }),
    created_at: row.created_at,
  };
}

export class ChatService {
  constructor(private db: Db) {}

  /**
   * Chats for the list: the job still answering (if any), whether anything is
   * working on it (that job or helpers in the background), whether an answer
   * arrived since the student last looked, and the helpers of its latest
   * delegation (background ones first, they may still be running).
   */
  async list(userId: string) {
    const rows = await many<
      ChatRow & {
        active_job_id: string | null;
        helpers_running: boolean;
        unread: boolean;
        bg_tasks: { goal?: string }[] | null;
        run_tasks: string[] | null;
      }
    >(
      this.db,
      `SELECT c.id, c.title, c.model_ref, c.kind, c.created_at, c.updated_at, c.parent_id, c.fork_label,
         (SELECT j.id FROM jobs j WHERE j.chat_id = c.id AND j.status IN ('queued', 'running', 'waiting_approval', 'waiting_mfa')
          ORDER BY j.queued_at DESC LIMIT 1) AS active_job_id,
         EXISTS (SELECT 1 FROM jobs j WHERE j.kind = 'delegate' AND j.payload->>'chat_id' = c.id::text AND j.status IN ('queued', 'running')) AS helpers_running,
         EXISTS (SELECT 1 FROM messages m WHERE m.chat_id = c.id AND m.role = 'assistant' AND NOT (m.meta ? 'internal')
                 AND m.created_at > c.last_read_at) AS unread,
         (SELECT j.payload->'tasks' FROM jobs j WHERE j.kind = 'delegate' AND j.payload->>'chat_id' = c.id::text
          ORDER BY j.queued_at DESC LIMIT 1) AS bg_tasks,
         (SELECT jsonb_path_query_array(m.meta->'tool_views', '$[*] ? (@.name == "agent_delegate").args.tasks[*].goal')
            FROM messages m WHERE m.chat_id = c.id AND m.role = 'assistant'
              AND jsonb_path_exists(m.meta->'tool_views', '$[*] ? (@.name == "agent_delegate")')
            ORDER BY m.seq DESC LIMIT 1) AS run_tasks
       FROM chats c WHERE c.user_id = $1 AND NOT c.archived AND NOT c.hidden ORDER BY c.updated_at DESC LIMIT 200`,
      [userId],
    );
    return rows.map(({ helpers_running, bg_tasks, run_tasks, unread, ...chat }) => {
      // The newest delegation: a background one while it runs, else the helpers of the latest answer that used them.
      const helpers = helpers_running && bg_tasks?.length
        ? bg_tasks.map((t) => ({ goal: String(t.goal ?? '').slice(0, 160), running: true }))
        : (run_tasks ?? bg_tasks?.map((t) => t.goal) ?? []).map((goal) => ({ goal: String(goal ?? '').slice(0, 160), running: false }));
      const working = Boolean(chat.active_job_id) || helpers_running;
      return { ...chat, working, unread: unread && !working, helpers: helpers.slice(0, 12) };
    });
  }

  /** The student looked at the chat: answers up to now are read. */
  async markRead(userId: string, chatId: string): Promise<void> {
    if (!UUID.test(chatId)) return;
    await this.db.query('UPDATE chats SET last_read_at = now() WHERE id = $1 AND user_id = $2', [chatId, userId]);
  }

  async get(userId: string, chatId: string) {
    if (!UUID.test(chatId)) throw notFound();
    const chat = await maybe<ChatRow & { active_job_id: string | null }>(
      this.db,
      `SELECT c.*, (SELECT j.id FROM jobs j WHERE j.chat_id = c.id AND j.status IN ('queued', 'running', 'waiting_approval', 'waiting_mfa')
          ORDER BY j.queued_at DESC LIMIT 1) AS active_job_id
       FROM chats c WHERE c.id = $1 AND c.user_id = $2 AND NOT c.hidden`,
      [chatId, userId],
    );
    if (!chat) throw notFound();
    return chat;
  }

  async create(userId: string, title: string, modelRef: string | null, kind: 'chat' | 'scheduled' = 'chat'): Promise<ChatRow> {
    const { rows } = await this.db.query<ChatRow>(
      'INSERT INTO chats (user_id, title, model_ref, kind) VALUES ($1, $2, $3, $4) RETURNING *',
      [userId, title.slice(0, 120), modelRef, kind],
    );
    return rows[0]!;
  }

  async rename(userId: string, chatId: string, title: string): Promise<void> {
    await this.get(userId, chatId);
    await this.db.query('UPDATE chats SET title = $1, updated_at = now() WHERE id = $2', [title.slice(0, 120), chatId]);
  }

  /** A chat and every fork under it, at every level, with their folders (deleting a chat deletes them all). */
  async withForks(userId: string, chatId: string): Promise<{ id: string; folder: string }[]> {
    if (!UUID.test(chatId)) return [];
    const rows = await many<{ id: string; folder: string | null }>(
      this.db,
      `WITH RECURSIVE tree AS (
         SELECT id, folder FROM chats WHERE id = $1 AND user_id = $2
         UNION ALL
         SELECT c.id, c.folder FROM chats c JOIN tree t ON c.parent_id = t.id
       ) SELECT id, folder FROM tree`,
      [chatId, userId],
    );
    return rows.map((r) => ({ id: r.id, folder: r.folder ?? chatFolder(r.id) }));
  }

  /**
   * Forks a chat: a new chat under it (numbered "1", "2", "2.1"...) with its
   * conversation up to `messageId` (an answer of the agent; the last finished
   * one when absent). File paths in the copied messages point at the fork's own
   * folder, which the caller fills with a copy of the original's.
   */
  async fork(userId: string, chatId: string, messageId?: string): Promise<ChatRow & { parent_id: string; fork_label: string; folder: string }> {
    const chat = await this.get(userId, chatId);
    const parent = await maybe<{ fork_label: string | null }>(this.db, 'SELECT fork_label FROM chats WHERE id = $1', [chat.id]);
    let cutoff: string | null;
    if (messageId) {
      if (!UUID.test(messageId)) throw notFound();
      const at = await maybe<{ seq: string; role: string; internal: boolean }>(
        this.db,
        "SELECT seq, role, meta ? 'internal' AS internal FROM messages WHERE id = $1 AND chat_id = $2",
        [messageId, chat.id],
      );
      if (!at) throw notFound();
      if (at.role !== 'assistant' || at.internal) throw conflict('chat.forkFromAnswer');
      cutoff = at.seq;
    } else {
      const last = await maybe<{ seq: string | null }>(
        this.db,
        "SELECT MAX(seq) AS seq FROM messages WHERE chat_id = $1 AND role = 'assistant' AND NOT (meta ? 'internal')",
        [chat.id],
      );
      cutoff = last?.seq ?? null;
    }
    if (!cutoff) throw conflict('chat.nothingToFork');

    const from = `${chatFolder(chat.id)}/`;
    const fromJson = JSON.stringify(from).slice(1, -1);
    return withTx(this.db, async (client) => {
      // Numbered in order under its parent; a fork of a fork extends the parent's number.
      await client.query('SELECT id FROM chats WHERE id = $1 FOR UPDATE', [chat.id]);
      const { rows: count } = await client.query<{ n: string }>('SELECT COUNT(*) AS n FROM chats WHERE parent_id = $1 AND NOT hidden', [chat.id]);
      const n = Number(count[0]!.n) + 1;
      const label = parent?.fork_label ? `${parent.fork_label}.${n}` : String(n);
      const { rows } = await client.query<ChatRow & { parent_id: string; fork_label: string; folder: string }>(
        `INSERT INTO chats (user_id, title, model_ref, kind, parent_id, fork_label) VALUES ($1, $2, $3, 'chat', $4, $5) RETURNING *`,
        [userId, chat.title, chat.model_ref, chat.id, label],
      );
      const forked = rows[0]!;
      const to = `${chatFolder(forked.id)}/`;
      const toJson = JSON.stringify(to).slice(1, -1);
      await client.query('UPDATE chats SET folder = $2 WHERE id = $1', [forked.id, chatFolder(forked.id)]);
      await client.query(
        `INSERT INTO messages (chat_id, role, content, tool_calls, tool_call_id, tool_name, meta, model_ref, model_label, tokens_in, tokens_out, created_at)
         SELECT $2, role, replace(content, $4, $5),
           CASE WHEN tool_calls IS NULL THEN NULL ELSE replace(tool_calls::text, $6, $7)::jsonb END,
           tool_call_id, tool_name, replace(meta::text, $6, $7)::jsonb, model_ref, model_label, tokens_in, tokens_out, created_at
         FROM messages WHERE chat_id = $1 AND seq <= $3 ORDER BY seq`,
        [chat.id, forked.id, cutoff, from, to, fromJson, toJson],
      );
      return { ...forked, folder: chatFolder(forked.id) };
    });
  }

  async remove(userId: string, chatId: string): Promise<void> {
    if (!UUID.test(chatId)) throw notFound();
    const result = await this.db.query('DELETE FROM chats WHERE id = $1 AND user_id = $2', [chatId, userId]);
    if (result.rowCount === 0) throw notFound();
  }

  /**
   * The chat's workspace folder, "Chats/<chat id>": unique, and it never changes
   * with the title (the Files views show the title instead). Older chats named
   * after their title are moved by migrateChatFolders.
   */
  async folderOf(userId: string, chatId: string): Promise<string> {
    const row = await maybe<{ folder: string | null }>(this.db, 'SELECT folder FROM chats WHERE id = $1 AND user_id = $2', [chatId, userId]);
    if (!row) throw notFound();
    if (row.folder) return row.folder;
    const saved = await maybe<{ folder: string }>(this.db, 'UPDATE chats SET folder = COALESCE(folder, $2) WHERE id = $1 RETURNING folder', [chatId, chatFolder(chatId)]);
    return saved!.folder;
  }

  /** Titles of this user's chats by id, for showing "Chats/<id>" folders by name. */
  async titlesById(userId: string, ids: string[]): Promise<Map<string, string>> {
    const valid = ids.filter((id) => UUID.test(id));
    if (!valid.length) return new Map();
    const rows = await many<{ id: string; title: string }>(this.db, 'SELECT id, title FROM chats WHERE user_id = $1 AND id = ANY($2::uuid[])', [userId, valid]);
    return new Map(rows.map((r) => [r.id, r.title]));
  }

  /** What the chat's info panel shows: messages, tokens, models and dates (its files come from the workspace). */
  async info(userId: string, chatId: string) {
    const chat = await this.get(userId, chatId);
    const stats = await maybe<{ user_messages: string; answers: string; tokens_in: string | null; tokens_out: string | null; models: string[] | null; last_answer: Date | null }>(
      this.db,
      `SELECT COUNT(*) FILTER (WHERE role = 'user' AND NOT (meta ? 'internal')) AS user_messages,
         COUNT(*) FILTER (WHERE role = 'assistant' AND NOT (meta ? 'internal')) AS answers,
         SUM(tokens_in) AS tokens_in, SUM(tokens_out) AS tokens_out,
         ARRAY_REMOVE(ARRAY_AGG(DISTINCT model_label), NULL) AS models,
         MAX(created_at) FILTER (WHERE role = 'assistant') AS last_answer
       FROM messages WHERE chat_id = $1`,
      [chat.id],
    );
    return {
      id: chat.id,
      title: chat.title,
      created_at: chat.created_at,
      updated_at: chat.updated_at,
      folder: await this.folderOf(userId, chat.id),
      messages: Number(stats?.user_messages ?? 0),
      answers: Number(stats?.answers ?? 0),
      tokens_in: Number(stats?.tokens_in ?? 0),
      tokens_out: Number(stats?.tokens_out ?? 0),
      models: stats?.models ?? [],
      last_answer_at: stats?.last_answer ?? null,
    };
  }

  /** One page the agent showed in a message of this user's chat (show_html), or null. */
  async display(userId: string, chatId: string, messageId: string, index: number): Promise<Display | null> {
    if (!UUID.test(chatId) || !UUID.test(messageId) || !Number.isInteger(index) || index < 0) return null;
    const row = await maybe<{ display: Display | null }>(
      this.db,
      `SELECT m.meta->'displays'->($4::int) AS display FROM messages m JOIN chats c ON c.id = m.chat_id
       WHERE m.id = $3 AND c.id = $2 AND c.user_id = $1`,
      [userId, chatId, messageId, index],
    );
    return row?.display ?? null;
  }

  /** What the user sees: their messages and each run's final answer. */
  async visibleMessages(chatId: string): Promise<MessageView[]> {
    const rows = await many<MessageRow>(
      this.db,
      `SELECT * FROM messages WHERE chat_id = $1 AND role <> 'tool' AND NOT (meta ? 'internal') ORDER BY seq`,
      [chatId],
    );
    return rows.map(toMessageView);
  }

  /** What the model sees: everything, tool calls and results included, oldest first. */
  async history(chatId: string): Promise<(ChatMessage & { attachments?: Attachment[] })[]> {
    return (await this.historyRows(chatId)).map((h) => h.message);
  }

  /**
   * What the model sees, each message with its seq: after a compaction, the
   * summary first (seq = where it ends) and only the messages after it.
   */
  async historyRows(chatId: string): Promise<{ seq: number; message: ChatMessage & { attachments?: Attachment[] } }[]> {
    const chat = await maybe<{ summary: string | null; summary_until_seq: string | null }>(this.db, 'SELECT summary, summary_until_seq FROM chats WHERE id = $1', [chatId]);
    const until = chat?.summary ? Number(chat.summary_until_seq) : 0;
    const rows = await many<MessageRow & { seq: string }>(this.db, 'SELECT * FROM messages WHERE chat_id = $1 AND seq > $2 ORDER BY seq', [chatId, until]);
    const kept = rows
      .filter((r) => !(r.role === 'assistant' && !r.content && !r.tool_calls?.length))
      .map((r) => {
        let message: ChatMessage & { attachments?: Attachment[] };
        if (r.role === 'tool') message = { role: 'tool', content: r.content, toolCallId: r.tool_call_id ?? '', name: r.tool_name ?? '' };
        else if (r.role === 'assistant') message = { role: 'assistant', content: r.content, ...(r.tool_calls?.length && { toolCalls: r.tool_calls }) };
        else message = { role: 'user', content: r.content, ...(r.meta.steer && { steer: true }), ...(r.meta.attachments?.length && { attachments: r.meta.attachments }) };
        return { seq: Number(r.seq), message };
      });
    return chat?.summary ? [{ seq: until, message: { role: 'user', content: chat.summary } }, ...kept] : kept;
  }

  /** Stores a compaction: the summary stands for every message up to `untilSeq`. */
  async saveSummary(chatId: string, summary: string, untilSeq: number, context: { used: number; window: number }): Promise<void> {
    await this.db.query('UPDATE chats SET summary = $2, summary_until_seq = $3 WHERE id = $1', [chatId, summary, untilSeq]);
    // The meter reads the newest answer's context.
    await this.db.query(
      `UPDATE messages SET meta = jsonb_set(meta, '{context}', $2::jsonb)
        WHERE id = (SELECT id FROM messages WHERE chat_id = $1 AND role = 'assistant' AND meta ? 'context' ORDER BY seq DESC LIMIT 1)`,
      [chatId, JSON.stringify(context)],
    );
  }

  async addUserMessage(db: Queryable, chatId: string, content: string, meta: Record<string, unknown> = {}): Promise<MessageView> {
    const { rows } = await db.query<MessageRow>(
      "INSERT INTO messages (chat_id, role, content, meta) VALUES ($1, 'user', $2, $3) RETURNING *",
      [chatId, content, meta],
    );
    await db.query('UPDATE chats SET updated_at = now() WHERE id = $1', [chatId]);
    return toMessageView(rows[0]!);
  }

  /**
   * Stores a run: its intermediate steps (hidden from the chat, kept for the
   * model), applied steers, and the final answer with the tool cards.
   */
  async saveRun(
    chatId: string,
    run: {
      produced: ChatMessage[];
      final: { content: string; toolViews: ToolCallView[]; modelRef: string; modelLabel: string; tokensIn: number; tokensOut: number; meta?: Record<string, unknown> };
      jobId: string;
    },
  ): Promise<MessageView> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      for (const m of run.produced) {
        if (m.role === 'user') {
          await client.query("INSERT INTO messages (chat_id, role, content, meta) VALUES ($1, 'user', $2, $3)", [
            chatId,
            m.content,
            { steer: Boolean(m.steer), job_id: run.jobId },
          ]);
        } else if (m.role === 'tool') {
          await client.query(
            "INSERT INTO messages (chat_id, role, content, tool_call_id, tool_name, meta) VALUES ($1, 'tool', $2, $3, $4, $5)",
            [chatId, m.content, m.toolCallId, m.name, { internal: true, job_id: run.jobId }],
          );
        } else if (m.role === 'assistant' && !m.toolCalls?.length && m.content.trim()) {
          // A whole answer written before a correction (steer) was applied: the student read it, so it stays a visible answer.
          await client.query(
            "INSERT INTO messages (chat_id, role, content, meta, model_ref, model_label) VALUES ($1, 'assistant', $2, $3, $4, $5)",
            [chatId, m.content, { job_id: run.jobId, before_steer: true }, run.final.modelRef, run.final.modelLabel],
          );
        } else if (m.role === 'assistant') {
          await client.query("INSERT INTO messages (chat_id, role, content, tool_calls, meta) VALUES ($1, 'assistant', $2, $3, $4)", [
            chatId,
            m.content,
            m.toolCalls?.length ? JSON.stringify(m.toolCalls) : null,
            { internal: true, job_id: run.jobId },
          ]);
        }
      }
      const f = run.final;
      const { rows } = await client.query<MessageRow>(
        `INSERT INTO messages (chat_id, role, content, meta, model_ref, model_label, tokens_in, tokens_out)
         VALUES ($1, 'assistant', $2, $3, $4, $5, $6, $7) RETURNING *`,
        [chatId, f.content, { tool_views: f.toolViews, job_id: run.jobId, ...f.meta }, f.modelRef, f.modelLabel, f.tokensIn, f.tokensOut],
      );
      await client.query('UPDATE chats SET updated_at = now() WHERE id = $1', [chatId]);
      await client.query('COMMIT');
      return toMessageView(rows[0]!);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  /** How full the model's context was in the last answer, for the meter in the composer. */
  async lastContext(chatId: string): Promise<{ used: number; window: number } | null> {
    const row = await maybe<{ context: { used: number; window: number } | null }>(
      this.db,
      `SELECT meta->'context' AS context FROM messages WHERE chat_id = $1 AND role = 'assistant' AND meta ? 'context' ORDER BY seq DESC LIMIT 1`,
      [chatId],
    );
    return row?.context ?? null;
  }

  /** Helper agents working in the background for this chat. */
  backgroundJobs(chatId: string) {
    return many<{ id: string; status: string; tasks: { goal: string }[] }>(
      this.db,
      `SELECT id, status, payload->'tasks' AS tasks FROM jobs
       WHERE kind = 'delegate' AND payload->>'chat_id' = $1 AND status IN ('queued', 'running') ORDER BY queued_at`,
      [chatId],
    );
  }

  pendingApprovals(chatId: string) {
    return many(
      this.db,
      `SELECT id, job_id, tool_name, summary, details, status FROM approvals WHERE chat_id = $1 AND status = 'pending' ORDER BY created_at`,
      [chatId],
    );
  }
}

/** Where every chat's folder lives in the workspace. */
export const CHATS_FOLDER = 'Chats';

/** A chat's workspace folder: its id, so it is unique and never changes with the title. */
export const chatFolder = (chatId: string) => `${CHATS_FOLDER}/${chatId}`;

/** A short title from the first message; good enough and free (no model call). */
export function titleFrom(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= 60) return clean;
  const cut = clean.slice(0, 60);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 30 ? cut.lastIndexOf(' ') : 60)}...`;
}
