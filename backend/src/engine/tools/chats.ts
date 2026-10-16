import { defineTool, type ToolContext } from 'pixlai-engine';
import type { ChatSearch } from '../../modules/chat/chat-search.js';

/** What the worker puts in `host.chats` for each run. */
export interface ChatsHost {
  search: ChatSearch;
  userId: string;
  /** This conversation, already in context: left out of searches. */
  currentChatId: string | null;
}

/**
 * Dates as the student's clock shows them ("Thu 2026-10-16 05:49"): the database
 * keeps UTC, and the model would otherwise read 09:49Z as the local time.
 */
function localTime(value: Date | string, timezone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(value))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.weekday} ${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

/** Every `at` / `updated_at` / `created_at` in a result, in the student's time zone. */
function withLocalTimes<T>(value: T, timezone: string): T {
  if (Array.isArray(value)) return value.map((v) => withLocalTimes(v, timezone)) as T;
  if (!value || typeof value !== 'object' || value instanceof Date) return value;
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, ['at', 'updated_at', 'created_at'].includes(k) && v ? localTime(v as Date | string, timezone) : withLocalTimes(v, timezone)]),
  ) as T;
}

function zoneOf(ctx: ToolContext): string {
  const tz = ctx.user.timezone || 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

function chatsOf(ctx: ToolContext): ChatsHost {
  const host = ctx.host.chats as ChatsHost | undefined;
  if (!host) throw new Error('Past chats are not available in this run');
  return host;
}

export const chatsSearch = defineTool<{ query?: string; days?: number; limit?: number }>({
  name: 'chats_search',
  summary: "search the student's other conversations with you",
  description:
    "Searches the student's other conversations with you (not this one), for when they refer to something said before " +
    '("like I told you", "the essay from last week", "what did you say about...") or earlier context would help. Returns ' +
    'matching messages with chat title, date, who said it and a snippet (matches in «»); open one with chats_read. Try a ' +
    'few wordings or key terms. Without a query: their most recent chats, to answer "what did we talk about yesterday".',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Words to find (any language; prefixes match). Omit to list recent chats' },
      days: { type: 'integer', description: 'Only the last N days' },
      limit: { type: 'integer', description: 'Results, 1-20 (default 8 matches or 10 chats)' },
    },
  },
  sideEffect: 'none',
  untrusted: true,
  parallelSafe: true,
  async run(args, ctx) {
    const host = chatsOf(ctx);
    const options = { exclude: host.currentChatId, limit: args.limit, days: args.days };
    const query = args.query?.trim();
    const tz = zoneOf(ctx);
    if (!query) {
      const chats = await host.search.recent(host.userId, options);
      return chats.length ? { times_in: tz, recent_chats: withLocalTimes(chats, tz) } : 'No other chats yet.';
    }
    const hits = await host.search.search(host.userId, query, options);
    return hits.length ? { times_in: tz, matches: withLocalTimes(hits, tz) } : `Nothing in past chats mentions "${query}". Try other words, or ask the student.`;
  },
});

export const chatsRead = defineTool<{ chat_id: string; around_message_id?: string; from?: number }>({
  name: 'chats_read',
  summary: 'read one of those past conversations',
  description:
    "Reads one of the student's past chats (an id from chats_search): up to 20 messages, around a message from a search " +
    '(around_message_id), from a position (from, 1-based), or by default its latest messages. Use the range it reports to read more.',
  parameters: {
    type: 'object',
    properties: {
      chat_id: { type: 'string' },
      around_message_id: { type: 'string', description: 'message_id from chats_search: show the conversation around it' },
      from: { type: 'integer', description: 'Start at this message (1-based)' },
    },
    required: ['chat_id'],
  },
  sideEffect: 'none',
  untrusted: true,
  parallelSafe: true,
  async run(args, ctx) {
    const host = chatsOf(ctx);
    if (!/^[0-9a-f-]{36}$/i.test(String(args.chat_id ?? ''))) throw new Error('chat_id is not a chat id from chats_search');
    const around = args.around_message_id && /^[0-9a-f-]{36}$/i.test(args.around_message_id) ? args.around_message_id : undefined;
    const page = await host.search.read(host.userId, args.chat_id, { around, from: args.from });
    if (!page) throw new Error('That chat does not exist or was deleted');
    const tz = zoneOf(ctx);
    return { times_in: tz, ...withLocalTimes(page, tz) };
  },
});

export const CHAT_TOOLS = [chatsSearch, chatsRead];
