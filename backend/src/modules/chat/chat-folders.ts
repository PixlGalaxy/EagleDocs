import type { Db } from '../../db/pool.js';
import { many } from '../../db/pool.js';
import { LOCKS, withAdvisoryLock } from '../../db/tx.js';
import type { DiskWorkspace } from '../../engine/workspace.js';
import { logger } from '../../logger.js';
import { CHATS_FOLDER, chatFolder } from './chat.service.js';
import { pruneLegacyUploads } from './attachments.js';

/**
 * Moves chats still in a folder named after their title ("Chats/hola") to
 * "Chats/<id>", and rewrites the paths their messages kept (attachments, the
 * agent's links and tool calls) so nothing points at the old folder. Runs at
 * start, once per cluster; a chat whose move fails keeps its old folder.
 */
export async function migrateChatFolders(db: Db, workspace: DiskWorkspace): Promise<void> {
  await withAdvisoryLock(db, LOCKS.chatFolders, async () => {
    const rows = await many<{ id: string; user_id: string; folder: string }>(
      db,
      `SELECT id, user_id, folder FROM chats WHERE folder IS NOT NULL AND folder <> $1 || '/' || id::text`,
      [CHATS_FOLDER],
    );
    for (const chat of rows) {
      const target = chatFolder(chat.id);
      try {
        const there = await workspace.stat(chat.user_id, chat.folder).catch(() => null);
        if (there) await workspace.move(chat.user_id, chat.folder, target);
        const from = `${chat.folder}/`;
        const to = `${target}/`;
        // In JSON the old path is written as a JSON string body: match it the same way.
        const fromJson = JSON.stringify(from).slice(1, -1);
        const toJson = JSON.stringify(to).slice(1, -1);
        await db.query(
          `UPDATE messages SET content = replace(content, $2, $3),
             meta = replace(meta::text, $4, $5)::jsonb,
             tool_calls = CASE WHEN tool_calls IS NULL THEN NULL ELSE replace(tool_calls::text, $4, $5)::jsonb END
           WHERE chat_id = $1 AND (strpos(content, $2) > 0 OR strpos(meta::text, $4) > 0 OR strpos(COALESCE(tool_calls::text, ''), $4) > 0)`,
          [chat.id, from, to, fromJson, toJson],
        );
        await db.query('UPDATE chats SET folder = $2 WHERE id = $1', [chat.id, target]);
        logger.info(`Chat ${chat.id}: files moved from "${chat.folder}" to "${target}"`);
      } catch (err) {
        logger.warn(`Chat ${chat.id}: could not move "${chat.folder}" to its id folder: ${(err as Error).message}`);
      }
    }
    // Uploads used to stage in "Chat uploads/<day>": remove what is left of it empty.
    const users = await many<{ user_id: string }>(db, 'SELECT DISTINCT user_id FROM chats');
    for (const { user_id } of users) await pruneLegacyUploads(workspace, user_id).catch(() => undefined);
  });
}

/** Deleting a chat deletes its folder too: nothing it uploaded or made stays behind. */
export async function deleteChatFolder(workspace: DiskWorkspace, userId: string, folder: string): Promise<void> {
  // Only a chat's own folder, never Chats/ itself or anything outside it.
  if (!folder.startsWith(`${CHATS_FOLDER}/`) || folder.split('/').length !== 2) return;
  if (await workspace.stat(userId, folder).catch(() => null)) await workspace.delete(userId, folder);
}
