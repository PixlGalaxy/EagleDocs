import type { Db } from '../../db/pool.js';
import { many, maybe } from '../../db/pool.js';

/** One place a past chat mentions the search. */
export interface ChatHit {
  chat_id: string;
  chat_title: string;
  message_id: string;
  /** Who said it: the student or Hawk. */
  said_by: 'student' | 'hawk';
  at: string;
  /** The matching words in «guillemets», with a little text around them. */
  snippet: string;
}

export interface RecentChat {
  chat_id: string;
  title: string;
  updated_at: string;
  messages: number;
  /** How it started: the student's first message, shortened. */
  first_message: string;
}

export interface ChatPage {
  chat_id: string;
  title: string;
  created_at: string;
  /** 1-based positions of the messages shown, out of `total`. */
  from: number;
  to: number;
  total: number;
  messages: { message_id: string; said_by: 'student' | 'hawk'; at: string; text: string }[];
}

const MAX_HITS = 20;
const PAGE = 20;
/** A long answer is cut here; chats_read around it shows the rest of the conversation. */
const MAX_MESSAGE_CHARS = 2500;
const ACCENTS_FROM = 'áàäâãéèëêíìïîóòöôõúùüûñç';
const ACCENTS_TO = 'aaaaaeeeeiiiiooooouuuunc';

/** Words of a search as prefixes ("calc" finds "calculo"), all required (`&`) or any (`|`). Null when nothing is left. */
export function toTsQuery(text: string, join: '&' | '|'): string | null {
  const words = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 2)
    .slice(0, 12);
  return words.length ? words.map((w) => `${w}:*`).join(` ${join} `) : null;
}

const VISIBLE = "m.role IN ('user', 'assistant') AND NOT (m.meta ? 'internal')";
const OWN_CHATS = 'c.user_id = $1 AND NOT c.hidden AND ($2::uuid IS NULL OR c.id <> $2::uuid)';
const saidBy = (role: string): 'student' | 'hawk' => (role === 'user' ? 'student' : 'hawk');

/** The student's past conversations, for Hawk to look things up in (never another student's). */
export class ChatSearch {
  constructor(private db: Db) {}

  /**
   * Messages that mention `query`, best first. All words must match; if none
   * do, any word; if still nothing, the phrase ignoring accents and case.
   */
  async search(userId: string, query: string, options: { exclude?: string | null; limit?: number; days?: number } = {}): Promise<ChatHit[]> {
    const limit = Math.min(Math.max(options.limit ?? 8, 1), MAX_HITS);
    const days = options.days && options.days > 0 ? Math.min(options.days, 3650) : null;
    const exclude = options.exclude ?? null;
    for (const join of ['&', '|'] as const) {
      const tsq = toTsQuery(query, join);
      if (!tsq) break;
      const hits = await many<ChatHit>(
        this.db,
        `WITH ranked AS (
           SELECT m.id, m.chat_id, m.role, m.created_at, m.content, ts_rank(m.tsv, q) AS rank
           FROM messages m JOIN chats c ON c.id = m.chat_id, to_tsquery('simple', $3) q
           WHERE ${OWN_CHATS} AND m.tsv @@ q AND ($5::int IS NULL OR m.created_at > now() - make_interval(days => $5::int))
           ORDER BY rank DESC, m.created_at DESC LIMIT $4
         )
         SELECT r.chat_id, c.title AS chat_title, r.id AS message_id, CASE WHEN r.role = 'user' THEN 'student' ELSE 'hawk' END AS said_by,
           r.created_at AS at,
           ts_headline('simple', left(r.content, 20000), to_tsquery('simple', $3),
             'MaxWords=35, MinWords=15, MaxFragments=2, FragmentDelimiter=" … ", StartSel=«, StopSel=»') AS snippet
         FROM ranked r JOIN chats c ON c.id = r.chat_id ORDER BY r.rank DESC, r.created_at DESC`,
        [userId, exclude, tsq, limit, days],
      );
      if (hits.length) return hits;
    }
    // Accents and odd spellings ("compas" for "compás"): the phrase anywhere, the slow way.
    const phrase = query.trim().toLowerCase();
    if (phrase.length < 2) return [];
    const rows = await many<{ chat_id: string; chat_title: string; message_id: string; role: string; at: string; content: string }>(
      this.db,
      `SELECT m.chat_id, c.title AS chat_title, m.id AS message_id, m.role, m.created_at AS at, left(m.content, 20000) AS content
       FROM messages m JOIN chats c ON c.id = m.chat_id
       WHERE ${OWN_CHATS} AND ${VISIBLE}
         AND translate(lower(m.content), '${ACCENTS_FROM}', '${ACCENTS_TO}') LIKE '%' || translate($3, '${ACCENTS_FROM}', '${ACCENTS_TO}') || '%'
         AND ($5::int IS NULL OR m.created_at > now() - make_interval(days => $5::int))
       ORDER BY m.created_at DESC LIMIT $4`,
      [userId, exclude, phrase.replace(/[%_\\]/g, ''), limit, days],
    );
    return rows.map((r) => ({ chat_id: r.chat_id, chat_title: r.chat_title, message_id: r.message_id, said_by: saidBy(r.role), at: r.at, snippet: around(r.content, phrase) }));
  }

  /** The newest chats, for "what did we talk about yesterday". */
  recent(userId: string, options: { exclude?: string | null; limit?: number; days?: number } = {}): Promise<RecentChat[]> {
    const limit = Math.min(Math.max(options.limit ?? 10, 1), MAX_HITS);
    const days = options.days && options.days > 0 ? Math.min(options.days, 3650) : null;
    return many<RecentChat>(
      this.db,
      `SELECT c.id AS chat_id, c.title, c.updated_at,
         (SELECT COUNT(*)::int FROM messages m WHERE m.chat_id = c.id AND ${VISIBLE}) AS messages,
         COALESCE((SELECT left(m.content, 200) FROM messages m WHERE m.chat_id = c.id AND m.role = 'user' AND NOT (m.meta ? 'internal') ORDER BY m.seq LIMIT 1), '') AS first_message
       FROM chats c
       WHERE ${OWN_CHATS} AND ($4::int IS NULL OR c.updated_at > now() - make_interval(days => $4::int))
       ORDER BY c.updated_at DESC LIMIT $3`,
      [userId, options.exclude ?? null, limit, days],
    );
  }

  /** A page of one chat: around a message from a search, from a position, or its latest messages. */
  async read(userId: string, chatId: string, options: { around?: string; from?: number } = {}): Promise<ChatPage | null> {
    const chat = await maybe<{ id: string; title: string; created_at: string }>(
      this.db,
      'SELECT id, title, created_at FROM chats WHERE id = $1 AND user_id = $2 AND NOT hidden',
      [chatId, userId],
    );
    if (!chat) return null;
    const all = await many<{ id: string; role: string; created_at: string; content: string }>(
      this.db,
      `SELECT m.id, m.role, m.created_at, left(m.content, ${MAX_MESSAGE_CHARS + 1}) AS content FROM messages m WHERE m.chat_id = $1 AND ${VISIBLE} ORDER BY m.seq`,
      [chatId],
    );
    const total = all.length;
    let start: number;
    const hit = options.around ? all.findIndex((m) => m.id === options.around) : -1;
    if (hit >= 0) start = Math.max(0, hit - Math.floor(PAGE / 2));
    else if (options.from && options.from > 0) start = Math.min(options.from - 1, Math.max(0, total - 1));
    else start = Math.max(0, total - PAGE);
    const slice = all.slice(start, start + PAGE);
    return {
      chat_id: chat.id,
      title: chat.title,
      created_at: chat.created_at,
      from: total ? start + 1 : 0,
      to: start + slice.length,
      total,
      messages: slice.map((m) => ({
        message_id: m.id,
        said_by: saidBy(m.role),
        at: m.created_at,
        text: m.content.length > MAX_MESSAGE_CHARS ? `${m.content.slice(0, MAX_MESSAGE_CHARS)} […]` : m.content,
      })),
    };
  }
}

/** A short window of `text` around `phrase` (accent-insensitive), for fallback hits. */
function around(text: string, phrase: string): string {
  const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const at = fold(text).indexOf(fold(phrase));
  if (at < 0) return text.slice(0, 200);
  const start = Math.max(0, at - 90);
  return `${start > 0 ? '… ' : ''}${text.slice(start, at)}«${text.slice(at, at + phrase.length)}»${text.slice(at + phrase.length, at + phrase.length + 110)}…`;
}
