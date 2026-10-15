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

/**
 * The agent's markdown files for one user, in the style of Hermes Agent:
 * SOUL.md (its personality), USER.md (who the user is) and MEMORY.md (its own
 * notes). All three go into every conversation; the agent edits them with
 * memory_update and the user can edit them too.
 */
export type MemoryDoc = 'soul' | 'user' | 'notes';
export type MemoryDocs = Record<MemoryDoc, string>;

export interface MemoryStore {
  /** Empty strings for files that do not exist yet. */
  read(userId: string): Promise<MemoryDocs>;
  write(userId: string, doc: MemoryDoc, content: string): Promise<void>;
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

// ------------------------------------------------------------------ sandbox (code pack)

export type CodeLanguage = 'python' | 'node' | 'shell';

export interface ExecRequest {
  language: CodeLanguage;
  code: string;
  /** Working directory relative to the user's workspace root ("" is the root). */
  cwd: string;
  timeoutMs: number;
}

export interface ExecResult {
  /** null when the process was killed (timeout, memory limit). */
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
  /** Workspace files the run created or changed, when the host can tell. */
  files?: { path: string; size: number }[];
}

/**
 * Runs code for a user in an isolated environment where their workspace is
 * the working tree (the same files the WorkspacePort serves). Isolation,
 * resource limits and network policy are the host's job.
 */
export interface SandboxPort {
  /** One line for the system prompt: what is installed and what is not allowed (e.g. "no network"). */
  describe(userId: string): Promise<string>;
  exec(userId: string, request: ExecRequest, signal: AbortSignal): Promise<ExecResult>;
}

// ------------------------------------------------------------------ web (web pack)

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

/** Web search. Any backend: a metasearch engine (SearXNG), an API (Brave, Google CSE), a scraper. */
export interface SearchPort {
  /** `userId`: who is searching, for providers that act per user (e.g. their own browser). */
  search(query: string, options: { limit: number; language?: string; signal: AbortSignal; userId?: string }): Promise<SearchHit[]>;
}

export interface FetchedPage {
  /** Final URL after redirects. */
  url: string;
  status: number;
  contentType: string;
  body: Buffer;
}

/**
 * Downloads a public URL. The host enforces the network policy: block private
 * addresses (SSRF), cap the size, follow redirects safely.
 */
export interface FetchPort {
  fetch(url: string, options: { maxBytes: number; signal: AbortSignal }): Promise<FetchedPage>;
}

// ------------------------------------------------------------------ browser (browser pack)

export interface BrowserPage {
  url: string;
  title: string;
  /**
   * The page as text for the model: an accessibility-tree outline where every
   * interactive element carries a ref like [@e12] for click/type.
   */
  snapshot: string;
}

export type BrowserAction =
  | { kind: 'click'; ref: string }
  | { kind: 'type'; ref: string; text: string; submit: boolean }
  | { kind: 'press'; key: string }
  | { kind: 'scroll'; direction: 'up' | 'down' }
  | { kind: 'back' };

/**
 * A real browser per user. `profile` separates cookie jars (e.g. "default",
 * "outlook"); profiles persist between runs so logins survive.
 */
export interface BrowserPort {
  open(userId: string, profile: string, url: string, signal: AbortSignal): Promise<BrowserPage>;
  snapshot(userId: string, profile: string, signal: AbortSignal): Promise<BrowserPage>;
  act(userId: string, profile: string, action: BrowserAction, signal: AbortSignal): Promise<BrowserPage>;
  /** Saves a PNG of the visible page into the workspace and returns its path. */
  screenshot(userId: string, profile: string, signal: AbortSignal): Promise<{ path: string }>;
  /** URL of the open page, or null when the profile has no page open. */
  currentUrl(userId: string, profile: string): Promise<string | null>;
  close(userId: string, profile: string): Promise<void>;
}

/**
 * Decides, per action and page, whether the agent may act freely, must ask the
 * user, or may not act at all (e.g. a site that must stay read-only).
 */
export type BrowserPolicy = (
  userId: string,
  url: string,
  action: BrowserAction['kind'],
) => Promise<'allow' | 'approve' | { block: string }>;
