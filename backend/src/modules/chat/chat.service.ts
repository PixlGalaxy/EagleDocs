import type { ChatMessage, Display, ToolCallRequest, ToolCallView, UserQuestion } from 'pixlai-engine';
import type { Db, Queryable } from '../../db/pool.js';
import { many, maybe } from '../../db/pool.js';
import { notFound } from '../../errors.js';
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
    ...(row.meta.displays?.length && { displays: row.meta.displays.map((d) => ({ kind: d.kind, title: d.title })) }),
    created_at: row.created_at,
  };
}

export class ChatService {
  constructor(private db: Db) {}

  /** Chats with the id of the job still working on them, if any. */
  list(userId: string) {
    return many<ChatRow & { active_job_id: string | null }>(
      this.db,
      `SELECT c.id, c.title, c.model_ref, c.kind, c.created_at, c.updated_at,
         (SELECT j.id FROM jobs j WHERE j.chat_id = c.id AND j.status IN ('queued', 'running', 'waiting_approval', 'waiting_mfa')
          ORDER BY j.queued_at DESC LIMIT 1) AS active_job_id
       FROM chats c WHERE c.user_id = $1 AND NOT c.archived ORDER BY c.updated_at DESC LIMIT 200`,
      [userId],
    );
  }

  async get(userId: string, chatId: string) {
    if (!UUID.test(chatId)) throw notFound();
    const chat = await maybe<ChatRow & { active_job_id: string | null }>(
      this.db,
      `SELECT c.*, (SELECT j.id FROM jobs j WHERE j.chat_id = c.id AND j.status IN ('queued', 'running', 'waiting_approval', 'waiting_mfa')
          ORDER BY j.queued_at DESC LIMIT 1) AS active_job_id
       FROM chats c WHERE c.id = $1 AND c.user_id = $2`,
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

  async remove(userId: string, chatId: string): Promise<void> {
    if (!UUID.test(chatId)) throw notFound();
    const result = await this.db.query('DELETE FROM chats WHERE id = $1 AND user_id = $2', [chatId, userId]);
    if (result.rowCount === 0) throw notFound();
  }

  /**
   * The chat's workspace folder ("Chats/<title>"), named the first time it is
   * needed and kept when the chat is renamed. Another chat already using that
   * name gets this one's short id added. `titleHint` names a chat whose title
   * is not saved yet (its first message).
   */
  async folderOf(userId: string, chatId: string, titleHint = ''): Promise<string> {
    const row = await maybe<{ folder: string | null; title: string }>(this.db, 'SELECT folder, title FROM chats WHERE id = $1 AND user_id = $2', [chatId, userId]);
    if (!row) throw notFound();
    if (row.folder) return row.folder;
    const base = `${CHATS_FOLDER}/${folderSafe(row.title || titleHint) || 'Chat'}`;
    const taken = await maybe(this.db, 'SELECT 1 FROM chats WHERE user_id = $1 AND folder = $2', [userId, base]);
    const name = taken ? `${base} (${chatId.slice(0, 6)})` : base;
    const saved = await maybe<{ folder: string }>(this.db, 'UPDATE chats SET folder = COALESCE(folder, $2) WHERE id = $1 RETURNING folder', [chatId, name]);
    return saved!.folder;
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

/** A chat title as a folder name: no separators or characters Windows refuses, no leading dots, short. */
export function folderSafe(title: string): string {
  return title
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .slice(0, 60)
    .trim();
}

/** A short title from the first message; good enough and free (no model call). */
export function titleFrom(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= 60) return clean;
  const cut = clean.slice(0, 60);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 30 ? cut.lastIndexOf(' ') : 60)}...`;
}
