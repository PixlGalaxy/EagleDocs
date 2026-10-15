import type pg from 'pg';
import type { Db } from '../../db/pool.js';
import { maybe } from '../../db/pool.js';
import { withTx } from '../../db/tx.js';
import { conflict, notFound } from '../../errors.js';

/**
 * Versions of an edited message, like ChatGPT's < 1/2 >. The chat keeps showing
 * one version; every other one (its message and all that followed it) waits in
 * a hidden chat under it, with the same folder, never listed. Editing moves the
 * shown version out and starts a new one; switching swaps them back.
 */

const ACTIVE = ['queued', 'running', 'waiting_approval', 'waiting_mfa'];

interface Anchor {
  id: string;
  seq: string;
  content: string;
  meta: { version_group?: string; version?: number; attachments?: unknown[]; internal?: boolean; steer?: boolean };
}

/** Locks the chat and refuses while an answer is being written in it. */
async function lockIdle(client: pg.PoolClient, chatId: string): Promise<void> {
  await client.query('SELECT id FROM chats WHERE id = $1 FOR UPDATE', [chatId]);
  const { rows } = await client.query('SELECT 1 FROM jobs WHERE chat_id = $1 AND status = ANY($2) LIMIT 1', [chatId, ACTIVE]);
  if (rows.length) throw conflict('chat.busy');
}

/** The student's own message in the chat (not a correction sent mid-answer, not a hidden note). */
async function userMessage(client: pg.PoolClient, chatId: string, messageId: string): Promise<Anchor> {
  const { rows } = await client.query<Anchor>(`SELECT id, seq, content, meta FROM messages WHERE id = $1 AND chat_id = $2 AND role = 'user'`, [messageId, chatId]);
  const m = rows[0];
  if (!m || m.meta.internal || m.meta.steer) throw notFound();
  return m;
}

/** Moves the chat's messages from `seq` on into a new hidden chat holding that version. */
async function stash(client: pg.PoolClient, chat: { id: string; user_id: string; title: string; model_ref: string | null; folder: string | null }, fromSeq: string, group: string, version: number) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO chats (user_id, title, model_ref, kind, parent_id, folder, hidden, version_group, version)
     VALUES ($1, $2, $3, 'chat', $4, $5, true, $6, $7) RETURNING id`,
    [chat.user_id, chat.title, chat.model_ref, chat.id, chat.folder, group, version],
  );
  await client.query('UPDATE messages SET chat_id = $3 WHERE chat_id = $1 AND seq >= $2', [chat.id, fromSeq, rows[0]!.id]);
  // A summary covering what moved out no longer describes the chat.
  await client.query('UPDATE chats SET summary = NULL, summary_until_seq = NULL WHERE id = $1 AND summary_until_seq >= $2', [chat.id, fromSeq]);
}

async function chatRow(client: pg.PoolClient, userId: string, chatId: string) {
  const { rows } = await client.query<{ id: string; user_id: string; title: string; model_ref: string | null; folder: string | null }>(
    'SELECT id, user_id, title, model_ref, folder FROM chats WHERE id = $1 AND user_id = $2 AND NOT hidden',
    [chatId, userId],
  );
  if (!rows[0]) throw notFound();
  return rows[0];
}

/**
 * Edits one of the student's messages: the version shown so far (that message
 * and everything after it) is kept hidden, and the new text continues the chat
 * as the next version. Returns the new message's id; the caller queues the answer.
 */
export async function editMessage(db: Db, userId: string, chatId: string, messageId: string, content: string, queue: (client: pg.PoolClient) => Promise<string>) {
  return withTx(db, async (client) => {
    const chat = await chatRow(client, userId, chatId);
    await lockIdle(client, chat.id);
    const old = await userMessage(client, chat.id, messageId);
    const group = old.meta.version_group ?? old.id;
    const current = old.meta.version ?? 1;
    const { rows: top } = await client.query<{ n: number | null }>(
      'SELECT MAX(version) AS n FROM chats WHERE parent_id = $1 AND hidden AND version_group = $2',
      [chat.id, group],
    );
    const next = Math.max(current, top[0]?.n ?? 0) + 1;
    // The old message keeps its place in its version, tagged with it.
    await client.query("UPDATE messages SET meta = meta || $2::jsonb WHERE id = $1", [old.id, JSON.stringify({ version_group: group, version: current })]);
    await stash(client, chat, old.seq, group, current);
    const meta = { version_group: group, version: next, ...(old.meta.attachments?.length && { attachments: old.meta.attachments }) };
    const { rows } = await client.query<{ id: string }>("INSERT INTO messages (chat_id, role, content, meta) VALUES ($1, 'user', $2, $3) RETURNING id", [chat.id, content, meta]);
    await client.query('UPDATE chats SET updated_at = now() WHERE id = $1', [chat.id]);
    const jobId = await queue(client);
    return { messageId: rows[0]!.id, jobId };
  });
}

/** Shows another version of an edited message: the one shown now is kept hidden, the chosen one comes back. */
export async function switchVersion(db: Db, userId: string, chatId: string, messageId: string, version: number) {
  return withTx(db, async (client) => {
    const chat = await chatRow(client, userId, chatId);
    await lockIdle(client, chat.id);
    const shown = await userMessage(client, chat.id, messageId);
    const group = shown.meta.version_group;
    if (!group) throw notFound();
    const current = shown.meta.version ?? 1;
    if (version === current) return;
    const target = await maybe<{ id: string }>(client, 'SELECT id FROM chats WHERE parent_id = $1 AND hidden AND version_group = $2 AND version = $3', [chat.id, group, version]);
    if (!target) throw notFound();
    await stash(client, chat, shown.seq, group, current);
    await client.query('UPDATE messages SET chat_id = $2 WHERE chat_id = $1', [target.id, chat.id]);
    await client.query('DELETE FROM chats WHERE id = $1', [target.id]);
    await client.query('UPDATE chats SET updated_at = now() WHERE id = $1', [chat.id]);
  });
}

/** How many versions each edited message of the chat has (message group -> count), for the < n/m > arrows. */
export async function versionCounts(db: Db, chatId: string): Promise<Map<string, number>> {
  const { rows } = await db.query<{ version_group: string; n: string }>(
    'SELECT version_group, COUNT(*) AS n FROM chats WHERE parent_id = $1 AND hidden GROUP BY version_group',
    [chatId],
  );
  // The hidden ones plus the version shown in the chat.
  return new Map(rows.map((r) => [r.version_group, Number(r.n) + 1]));
}
