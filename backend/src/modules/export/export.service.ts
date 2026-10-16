import type { FileEntry } from 'pixlai-engine';
import { RAG_DIR } from 'pixlai-engine';
import type { Db } from '../../db/pool.js';
import { many, maybe } from '../../db/pool.js';
import { BROWSER_DIR, TEMP, type DiskWorkspace } from '../../engine/workspace.js';
import { logger } from '../../logger.js';
import type { ZipEntry, ZipSource } from './zip-stream.js';

/** Already compressed: deflating them again only costs CPU. */
const STORED = /\.(png|jpe?g|gif|webp|avif|heic|mp3|m4a|aac|ogg|opus|mp4|m4v|mov|mkv|webm|zip|gz|tgz|bz2|xz|zst|7z|rar|pdf|docx|xlsx|pptx|odt|ods|odp|epub|jar|woff2?)$/i;
/** An upload still streaming (DiskWorkspace.writeStream). */
const PARTIAL = /\.[0-9a-f]{16}\.part$/;
const MAX_DEPTH = 64;
const DOC_FILES = { soul: 'SOUL.md', user: 'USER.md', notes: 'MEMORY.md' } as const;

interface ChatRow {
  id: string;
  title: string;
  kind: string;
  folder: string | null;
  archived: boolean;
  hidden: boolean;
  parent_id: string | null;
  created_at: Date;
  updated_at: Date;
}

interface MessageRow {
  role: 'user' | 'assistant';
  content: string;
  meta: {
    internal?: boolean;
    steer?: boolean;
    failed?: string;
    stopped?: boolean;
    tool_views?: { name: string; status: string }[];
    attachments?: { path: string; name: string }[];
  };
  model_label: string | null;
  model_ref: string | null;
  created_at: Date;
}

/**
 * "Export my data": everything StudyHawk keeps about one student, as ZIP entries produced one at a time
 * (zip-stream.ts writes them as they come, so nothing large is held). Never any secret: no password hash,
 * session, token, API key or encrypted column is read here.
 */
export class ExportService {
  constructor(
    private db: Db,
    private workspace: DiskWorkspace,
  ) {}

  /** The small account data, read before the download starts so a database error is still a clean HTTP error. */
  async collect(userId: string) {
    const [profile, connections, devices, schedules, skills, docs, imageNotes, chats] = await Promise.all([
      maybe(
        this.db,
        `SELECT u.display_name AS name, u.username, u.email, i.name AS institution, u.major, u.language, u.timezone,
                (SELECT t.name FROM tiers t WHERE t.id = effective_tier(u.id)) AS plan, u.tier_expires_at AS plan_expires_at,
                u.role, u.theme_mode, u.theme_skin, u.memory_paused, u.email_verified_at, u.created_at
         FROM users u LEFT JOIN institutions i ON i.id = u.institution_id WHERE u.id = $1`,
        [userId],
      ),
      many(
        this.db,
        `SELECT kind, provider, label, status, last_ok_at, created_at, updated_at
         FROM connections WHERE user_id = $1 ORDER BY created_at`,
        [userId],
      ),
      maybe<{ n: number }>(this.db, 'SELECT COUNT(*)::int AS n FROM push_subscriptions WHERE user_id = $1', [userId]),
      many(
        this.db,
        `SELECT name, schedule, timezone, prompt, model_ref AS model, enabled, last_run_at, next_run_at, created_at
         FROM schedules WHERE user_id = $1 ORDER BY created_at`,
        [userId],
      ),
      many<{ slug: string; name: string; description: string; body_md: string; enabled: boolean; created_at: Date }>(
        this.db,
        'SELECT slug, name, description, body_md, enabled, created_at FROM user_skills WHERE user_id = $1 ORDER BY slug',
        [userId],
      ),
      many<{ doc: keyof typeof DOC_FILES; content: string; updated_at: Date }>(
        this.db,
        'SELECT doc, content, updated_at FROM agent_docs WHERE user_id = $1',
        [userId],
      ),
      many(
        this.db,
        'SELECT path, description, source, updated_at FROM image_notes WHERE user_id = $1 ORDER BY path',
        [userId],
      ),
      many<ChatRow>(
        this.db,
        `SELECT id, title, kind, folder, archived, hidden, parent_id, created_at, updated_at
         FROM chats WHERE user_id = $1 ORDER BY created_at`,
        [userId],
      ),
    ]);
    if (!profile) throw new Error('User not found');
    return { profile, connections, pushDevices: devices?.n ?? 0, schedules, skills, docs, imageNotes, chats };
  }

  /** Every entry of the archive, in order: README, data, memory, skills, chats, then the files. */
  async *entries(userId: string, data: Awaited<ReturnType<ExportService['collect']>>, now = new Date()): AsyncGenerator<ZipEntry> {
    const chatFile = (c: ChatRow) => `chats/${c.created_at.toISOString().slice(0, 10)}-${c.id}.json`;
    yield { name: 'README.txt', mtime: now, data: readme(now) };
    yield {
      name: 'data.json',
      mtime: now,
      data: json({
        exported_at: now.toISOString(),
        profile: data.profile,
        connections: data.connections,
        push_devices: data.pushDevices,
        scheduled_tasks: data.schedules,
        skills: data.skills.map(({ body_md: _, ...s }) => ({ ...s, file: `skills/${safeName(s.slug)}.md` })),
        memory: data.docs.map((d) => ({ file: `memory/${DOC_FILES[d.doc]}`, updated_at: d.updated_at })),
        image_descriptions: data.imageNotes,
        chats: data.chats.map((c) => ({
          id: c.id,
          title: c.title,
          kind: c.kind,
          folder: c.folder,
          archived: c.archived,
          // An edited message keeps the old continuation in a hidden chat under the original.
          version_of: c.hidden ? c.parent_id : null,
          forked_from: c.hidden ? null : c.parent_id,
          created_at: c.created_at,
          updated_at: c.updated_at,
          file: chatFile(c),
        })),
      }),
    };
    for (const d of data.docs) yield { name: `memory/${DOC_FILES[d.doc]}`, mtime: d.updated_at, data: d.content };
    for (const s of data.skills) yield { name: `skills/${safeName(s.slug)}.md`, mtime: s.created_at, data: s.body_md };

    // One chat at a time: only its own messages are in memory. Tool results are left out (large, and the
    // agent's own working data); each answer lists the tools it used.
    for (const c of data.chats) {
      const rows = await many<MessageRow>(
        this.db,
        `SELECT role, content, meta, model_label, model_ref, created_at FROM messages
         WHERE chat_id = $1 AND role IN ('user', 'assistant') ORDER BY seq`,
        [c.id],
      );
      const messages = rows
        // Internal notes are the agent's own; an empty step that only called tools shows in the answer's tool list.
        .filter((m) => !m.meta?.internal && !(m.role === 'assistant' && !m.content && !m.meta?.tool_views?.length))
        .map((m) => ({
          role: m.role,
          text: m.content,
          time: m.created_at,
          ...(m.role === 'assistant' && { model: m.model_label ?? m.model_ref }),
          ...(m.meta?.tool_views?.length && { tools: m.meta.tool_views.map((t) => ({ name: t.name, status: t.status })) }),
          ...(m.meta?.attachments?.length && { attachments: m.meta.attachments.map((a) => a.path) }),
          ...(m.meta?.steer && { steer: true }),
          ...(m.meta?.stopped && { stopped: true }),
          ...(m.meta?.failed && { failed: m.meta.failed }),
        }));
      yield { name: chatFile(c), mtime: c.updated_at, data: json({ id: c.id, title: c.title, created_at: c.created_at, messages }) };
    }

    yield* this.files(userId);
  }

  /**
   * The workspace and TEMP, the same tree as the Files page, through DiskWorkspace's own checks: listing skips
   * links, and each file is opened with O_NOFOLLOW and its real path confirmed inside the user's root.
   * Skipped: .browser/ (browser cookies and sessions), .rag/ (indexes rebuilt from the files) and partial uploads.
   */
  private async *files(userId: string): AsyncGenerator<ZipEntry> {
    const ws = this.workspace;
    const walk = async function* (path: string, depth: number): AsyncGenerator<ZipEntry> {
      let list: FileEntry[];
      try {
        list = await ws.list(userId, path);
      } catch {
        return; // gone or swapped for a link since its parent was listed
      }
      for (const e of list) {
        const atRoot = path === '' || path === TEMP;
        if (atRoot && (e.name === BROWSER_DIR || e.name === RAG_DIR)) continue;
        const name = `files/${e.path.split('/').map(safeName).join('/')}`;
        const mtime = new Date(e.modifiedAt);
        if (e.type === 'dir') {
          yield { name: `${name}/`, mtime };
          if (depth < MAX_DEPTH) yield* walk(e.path, depth + 1);
          continue;
        }
        if (PARTIAL.test(e.name)) continue;
        yield { name, mtime, compress: !STORED.test(e.name), open: () => openFile(ws, userId, e.path) };
      }
    };
    yield* walk('', 0);
  }
}

/** Reads at most the size seen when opened (the sandbox may still be writing); a read error ends the entry early. */
async function openFile(ws: DiskWorkspace, userId: string, path: string): Promise<ZipSource | null> {
  const opened = await ws.openRead(userId, path).catch(() => null);
  if (!opened) return null;
  const { handle, size } = opened;
  const stream = async function* (): AsyncGenerator<Buffer> {
    if (size === 0) return;
    try {
      for await (const chunk of handle.createReadStream({ start: 0, end: size - 1, autoClose: false })) yield chunk as Buffer;
    } catch (err) {
      logger.warn(`Data export: could not read ${path} to the end: ${(err as Error).message}`);
    }
  };
  return { size, stream: stream(), close: () => handle.close() };
}

/** Characters some extractors take as folder separators or refuse. */
function safeName(part: string): string {
  return part.replace(/[\\:*?"<>|\u0000-\u001f]/g, '_') || '_';
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function readme(now: Date): string {
  return [
    'StudyHawk data export',
    `Exported: ${now.toISOString()}`,
    '',
    'This archive holds everything StudyHawk keeps about your account.',
    '',
    'data.json         Your profile (name, username, email, institution, major, language, timezone, plan),',
    '                  connections (kind, label, status and dates only: passwords and tokens are never exported),',
    '                  the number of devices with notifications on, scheduled tasks, personal skills,',
    '                  descriptions of your pictures, and the list of your chats.',
    'chats/            One JSON file per chat: each message with its role, text, time and model, and the tools',
    '                  the assistant used (names only; tool output is not included).',
    'memory/           What the assistant remembers: SOUL.md (its personality), USER.md (about you),',
    '                  MEMORY.md (its own notes).',
    'skills/           Your personal skills, one Markdown file each.',
    'files/            Your files, the same folders as the Files page, TEMP/ included.',
    '                  Not included: search indexes (.rag, rebuilt from your files) and the browser\'s',
    '                  cookies and sessions (.browser).',
    '',
    'Times are in UTC (ISO 8601).',
    '',
  ].join('\r\n');
}
