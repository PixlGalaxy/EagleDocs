/**
 * Ports: what a host implements to run PixlAI-Engine. A typical host backs them
 * with Postgres; the tests use the in-memory versions in `memory-stores.ts`.
 * The engine keeps no state of its own between calls, so a host with several
 * processes works as long as these are shared.
 */

export interface PendingSteer {
  id: string;
  content: string;
}

export type ApprovalDecision = 'approved' | 'rejected' | 'expired';

export interface RunStore {
  /** Steers sent for this run that have not been applied yet; marks them applied. */
  takeSteers(runId: string): Promise<PendingSteer[]>;
  /** Calls `onSteer` as soon as a steer arrives (used to interrupt a generation). Returns unsubscribe. */
  watchSteers(runId: string, onSteer: () => void): () => void;
  createApproval(input: {
    runId: string;
    userId: string;
    toolName: string;
    args: Record<string, unknown>;
    summary: string;
    details: Record<string, string>;
  }): Promise<{ id: string }>;
  /** Resolves when the user decides, the timeout passes ('expired') or the signal aborts. */
  waitForApproval(approvalId: string, timeoutMs: number, signal: AbortSignal): Promise<ApprovalDecision>;
}

export interface MemoryItem {
  id: string;
  content: string;
  createdAt: string;
}

export interface MemoryStore {
  add(userId: string, content: string, source: 'agent' | 'user'): Promise<MemoryItem>;
  remove(userId: string, id: string): Promise<boolean>;
  search(userId: string, query: string, limit: number): Promise<MemoryItem[]>;
  /** What goes into the system prompt: the most useful memories for this message. */
  forPrompt(userId: string, latestUserMessage: string, limit: number): Promise<MemoryItem[]>;
}

export interface SkillSummary {
  slug: string;
  name: string;
  description: string;
}

export interface SkillStore {
  /** Enabled skills for this user (built-in, organization and personal). */
  list(userId: string): Promise<SkillSummary[]>;
  /** Full instructions of one skill, or null if it is not available to the user. */
  load(userId: string, slug: string): Promise<{ name: string; body: string; notes: string[] } | null>;
  /** A short lesson learned while using the skill, shown next time it loads. */
  addNote(userId: string, slug: string, note: string): Promise<void>;
}

export interface Schedule {
  id: string;
  name: string;
  /** Cron expression ("0 8 * * 1"), an interval ("every 2h") or an ISO date for a one-off. */
  schedule: string;
  timezone: string;
  prompt: string;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
}

export interface ScheduleStore {
  list(userId: string): Promise<Schedule[]>;
  create(userId: string, input: Omit<Schedule, 'id' | 'lastRunAt'>): Promise<Schedule>;
  update(userId: string, id: string, patch: Partial<Omit<Schedule, 'id'>>): Promise<Schedule | null>;
  remove(userId: string, id: string): Promise<boolean>;
}

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string, detail?: unknown): void;
}

export interface Clock {
  now(): Date;
}

// ------------------------------------------------------------------ workspace (files pack)

export interface FileEntry {
  /** Path relative to the user's root, with `/` separators, e.g. "Fall 2026/ACG 2021/notes.md". */
  path: string;
  name: string;
  type: 'file' | 'dir';
  size: number;
  modifiedAt: string;
}

export interface StorageArea {
  /** e.g. "workspace" or "TEMP". */
  name: string;
  usedBytes: number;
  limitBytes: number;
  /** Rule the agent must know, e.g. "files here are deleted 24 h after their last change". */
  note?: string;
}

/**
 * A user's files. Paths are always relative to the user's own root; the host
 * maps them to real storage, enforces quotas and refuses anything outside the
 * root. How areas are laid out (e.g. a "TEMP/" folder with its own quota) is
 * the host's choice, explained to the model through `describe`.
 */
export interface WorkspacePort {
  /** Text for the system prompt: layout, quotas and rules (e.g. what gets deleted when). */
  describe(userId: string): Promise<string>;
  list(userId: string, path: string): Promise<FileEntry[]>;
  stat(userId: string, path: string): Promise<FileEntry | null>;
  read(userId: string, path: string): Promise<Buffer>;
  /** Creates parent folders as needed. Throws when the quota would be exceeded. */
  write(userId: string, path: string, data: Buffer | string, options?: { append?: boolean }): Promise<void>;
  mkdir(userId: string, path: string): Promise<void>;
  move(userId: string, from: string, to: string): Promise<void>;
  /** Folders are deleted with their contents. */
  delete(userId: string, path: string): Promise<void>;
  usage(userId: string): Promise<StorageArea[]>;
}

/** Turns documents into text. Return null for formats it does not handle. */
export interface TextExtractor {
  extract(data: Buffer, filename: string): Promise<{ pages: string[] } | null>;
}

/** Text embeddings for RAG. Vectors of every call must have the same length for one `model`. */
export interface EmbeddingPort {
  /** Identifies the embedding space; a RAG built with one model cannot be searched with another. */
  readonly model: string;
  embed(texts: string[], signal?: AbortSignal): Promise<number[][]>;
}

export interface SharedRagInfo {
  /** Unique id, e.g. "course-123/textbook". Shown to the model as "shared:<id>". */
  id: string;
  name: string;
  description: string;
  model: string;
  chunks: number;
}

/**
 * Read-only collections someone else built for this user to search (e.g. an
 * instructor's RAG of the course textbook). Optional: without it, users only
 * see their own RAGs. Files use the same format as a user RAG (manifest.json,
 * chunks.jsonl, vectors.f32).
 */
export interface SharedRagSource {
  list(userId: string): Promise<SharedRagInfo[]>;
  readFile(userId: string, id: string, file: 'manifest.json' | 'chunks.jsonl' | 'vectors.f32'): Promise<Buffer | null>;
}
