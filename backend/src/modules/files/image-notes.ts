import type { Db } from '../../db/pool.js';
import { many, maybe } from '../../db/pool.js';
import { toTsQuery } from '../chat/chat-search.js';

export interface ImageNote {
  path: string;
  description: string;
  source: 'generated' | 'viewed';
  updated_at: string;
}

/** The file as it is now: a note is only good for this exact version of it. */
export interface FileVersion {
  size: number;
  modifiedAt: string;
}

/** What the pictures in a student's workspace show, in words (image_notes). */
export class ImageNotes {
  constructor(private db: Db) {}

  /** The note for this version of the file, or null when there is none or the file changed since. */
  async get(userId: string, path: string, file: FileVersion): Promise<ImageNote | null> {
    const note = await maybe<ImageNote>(
      this.db,
      `SELECT path, description, source, updated_at FROM image_notes
       WHERE user_id = $1 AND path = $2 AND size = $3 AND modified_at = $4::timestamptz`,
      [userId, path, file.size, file.modifiedAt],
    );
    return note ?? null;
  }

  async save(userId: string, path: string, file: FileVersion, description: string, source: ImageNote['source']): Promise<void> {
    await this.db.query(
      `INSERT INTO image_notes (user_id, path, size, modified_at, description, source) VALUES ($1, $2, $3, $4::timestamptz, $5, $6)
       ON CONFLICT (user_id, path) DO UPDATE SET size = excluded.size, modified_at = excluded.modified_at,
         description = excluded.description, source = excluded.source, updated_at = now()`,
      [userId, path, file.size, file.modifiedAt, description.slice(0, 20000), source],
    );
  }

  /** Pictures whose path or description matches, best first (all words, then any). */
  async search(userId: string, query: string, limit: number): Promise<ImageNote[]> {
    for (const join of ['&', '|'] as const) {
      const tsq = toTsQuery(query, join);
      if (!tsq) break;
      const rows = await many<ImageNote>(
        this.db,
        `SELECT path, description, source, updated_at FROM image_notes, to_tsquery('simple', $2) q
         WHERE user_id = $1 AND tsv @@ q ORDER BY ts_rank(tsv, q) DESC, updated_at DESC LIMIT $3`,
        [userId, tsq, limit],
      );
      if (rows.length) return rows;
    }
    return [];
  }

  /** A note whose file is gone (deleted or moved). */
  async forget(userId: string, path: string): Promise<void> {
    await this.db.query('DELETE FROM image_notes WHERE user_id = $1 AND path = $2', [userId, path]);
  }
}
