import { randomUUID } from 'crypto';
import type {
  ApprovalDecision,
  FileEntry,
  StorageArea,
  WorkspacePort,
  MemoryItem,
  MemoryStore,
  PendingSteer,
  RunStore,
  Schedule,
  ScheduleStore,
  SkillStore,
  SkillSummary,
} from './ports.js';

/**
 * In-process implementations of every store: for tests, demos and
 * single-process hosts. State is lost on restart.
 */
export class InMemoryRunStore implements RunStore {
  private steers = new Map<string, PendingSteer[]>();
  private watchers = new Map<string, Set<() => void>>();
  private approvals = new Map<string, { decision?: ApprovalDecision; waiters: ((d: ApprovalDecision) => void)[] }>();
  /** Every approval created, newest last (handy in tests). */
  readonly created: { id: string; runId: string; toolName: string; summary: string }[] = [];

  /** Host side: the user sent a correction. */
  steer(runId: string, content: string): PendingSteer {
    const steer = { id: randomUUID(), content };
    const list = this.steers.get(runId) ?? [];
    list.push(steer);
    this.steers.set(runId, list);
    for (const watcher of this.watchers.get(runId) ?? []) watcher();
    return steer;
  }

  /** Host side: the user answered an approval. */
  decide(approvalId: string, decision: ApprovalDecision): void {
    const entry = this.approvals.get(approvalId);
    if (!entry || entry.decision) return;
    entry.decision = decision;
    for (const waiter of entry.waiters) waiter(decision);
  }

  async takeSteers(runId: string): Promise<PendingSteer[]> {
    const list = this.steers.get(runId) ?? [];
    this.steers.set(runId, []);
    return list;
  }

  watchSteers(runId: string, onSteer: () => void): () => void {
    const set = this.watchers.get(runId) ?? new Set();
    set.add(onSteer);
    this.watchers.set(runId, set);
    return () => set.delete(onSteer);
  }

  async createApproval(input: { runId: string; toolName: string; summary: string }): Promise<{ id: string }> {
    const id = randomUUID();
    this.approvals.set(id, { waiters: [] });
    this.created.push({ id, runId: input.runId, toolName: input.toolName, summary: input.summary });
    return { id };
  }

  waitForApproval(approvalId: string, timeoutMs: number, signal: AbortSignal): Promise<ApprovalDecision> {
    const entry = this.approvals.get(approvalId);
    if (!entry) return Promise.resolve('expired');
    if (entry.decision) return Promise.resolve(entry.decision);
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve('expired'), timeoutMs);
      const done = (decision: ApprovalDecision) => {
        clearTimeout(timer);
        resolve(decision);
      };
      entry.waiters.push(done);
      signal.addEventListener('abort', () => done('rejected'), { once: true });
    });
  }
}

export class InMemoryMemoryStore implements MemoryStore {
  private items = new Map<string, MemoryItem[]>();

  async add(userId: string, content: string): Promise<MemoryItem> {
    const item = { id: randomUUID().slice(0, 8), content, createdAt: new Date().toISOString() };
    this.items.set(userId, [...(this.items.get(userId) ?? []), item]);
    return item;
  }

  async remove(userId: string, id: string): Promise<boolean> {
    const list = this.items.get(userId) ?? [];
    const kept = list.filter((item) => item.id !== id);
    this.items.set(userId, kept);
    return kept.length !== list.length;
  }

  async search(userId: string, query: string, limit: number): Promise<MemoryItem[]> {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return (this.items.get(userId) ?? [])
      .filter((item) => words.some((word) => item.content.toLowerCase().includes(word)))
      .slice(0, limit);
  }

  async forPrompt(userId: string, _latest: string, limit: number): Promise<MemoryItem[]> {
    return (this.items.get(userId) ?? []).slice(-limit);
  }
}

export class InMemorySkillStore implements SkillStore {
  private notes = new Map<string, string[]>();

  constructor(private skills: (SkillSummary & { body: string })[] = []) {}

  async list(): Promise<SkillSummary[]> {
    return this.skills.map(({ slug, name, description }) => ({ slug, name, description }));
  }

  async load(userId: string, slug: string) {
    const skill = this.skills.find((s) => s.slug === slug);
    return skill ? { name: skill.name, body: skill.body, notes: this.notes.get(`${userId}:${slug}`) ?? [] } : null;
  }

  async addNote(userId: string, slug: string, note: string): Promise<void> {
    const key = `${userId}:${slug}`;
    this.notes.set(key, [...(this.notes.get(key) ?? []), note]);
  }
}

export class InMemoryScheduleStore implements ScheduleStore {
  private schedules = new Map<string, Schedule[]>();

  async list(userId: string): Promise<Schedule[]> {
    return this.schedules.get(userId) ?? [];
  }

  async create(userId: string, input: Omit<Schedule, 'id' | 'lastRunAt'>): Promise<Schedule> {
    const schedule = { ...input, id: randomUUID().slice(0, 8), lastRunAt: null };
    this.schedules.set(userId, [...(await this.list(userId)), schedule]);
    return schedule;
  }

  async update(userId: string, id: string, patch: Partial<Omit<Schedule, 'id'>>): Promise<Schedule | null> {
    const list = await this.list(userId);
    const index = list.findIndex((s) => s.id === id);
    if (index < 0) return null;
    list[index] = { ...list[index]!, ...patch };
    return list[index]!;
  }

  async remove(userId: string, id: string): Promise<boolean> {
    const list = await this.list(userId);
    this.schedules.set(userId, list.filter((s) => s.id !== id));
    return list.some((s) => s.id === id);
  }
}

/**
 * Files kept in memory, one tree per user, with a single quota. A reference
 * for hosts writing their own WorkspacePort (and what the tests use).
 */
export class InMemoryWorkspace implements WorkspacePort {
  private files = new Map<string, Map<string, { data: Buffer; modified: Date }>>();
  private dirs = new Map<string, Set<string>>();

  constructor(private limitBytes = 50 * 1024 * 1024, private note = 'Everything here is kept until deleted.') {}

  private tree(userId: string) {
    if (!this.files.has(userId)) {
      this.files.set(userId, new Map());
      this.dirs.set(userId, new Set(['']));
    }
    return { files: this.files.get(userId)!, dirs: this.dirs.get(userId)! };
  }

  private addParents(userId: string, path: string) {
    const { dirs } = this.tree(userId);
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
  }

  async describe(): Promise<string> {
    return `Your files. Quota ${Math.round(this.limitBytes / 1048576)} MB. ${this.note}`;
  }

  async list(userId: string, path: string): Promise<FileEntry[]> {
    const { files, dirs } = this.tree(userId);
    if (!dirs.has(path)) throw new Error(`Not a folder: ${path || '/'}`);
    const prefix = path ? `${path}/` : '';
    const out: FileEntry[] = [];
    for (const dir of dirs) {
      if (dir && dir.startsWith(prefix) && !dir.slice(prefix.length).includes('/')) {
        out.push({ path: dir, name: dir.slice(prefix.length), type: 'dir', size: 0, modifiedAt: new Date(0).toISOString() });
      }
    }
    for (const [file, entry] of files) {
      if (file.startsWith(prefix) && !file.slice(prefix.length).includes('/')) {
        out.push({ path: file, name: file.slice(prefix.length), type: 'file', size: entry.data.length, modifiedAt: entry.modified.toISOString() });
      }
    }
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  async stat(userId: string, path: string): Promise<FileEntry | null> {
    const { files, dirs } = this.tree(userId);
    const name = path.split('/').pop() ?? path;
    const file = files.get(path);
    if (file) return { path, name, type: 'file', size: file.data.length, modifiedAt: file.modified.toISOString() };
    return dirs.has(path) ? { path, name, type: 'dir', size: 0, modifiedAt: new Date(0).toISOString() } : null;
  }

  async read(userId: string, path: string): Promise<Buffer> {
    const file = this.tree(userId).files.get(path);
    if (!file) throw new Error(`Not found: ${path}`);
    return file.data;
  }

  async write(userId: string, path: string, data: Buffer | string, options?: { append?: boolean }): Promise<void> {
    const { files } = this.tree(userId);
    const incoming = typeof data === 'string' ? Buffer.from(data) : data;
    const previous = files.get(path)?.data;
    const next = options?.append && previous ? Buffer.concat([previous, incoming]) : incoming;
    const used = [...files.values()].reduce((n, f) => n + f.data.length, 0) - (previous?.length ?? 0);
    if (used + next.length > this.limitBytes) throw new Error('Not enough space: the quota is full');
    files.set(path, { data: next, modified: new Date() });
    this.addParents(userId, path);
  }

  async mkdir(userId: string, path: string): Promise<void> {
    this.tree(userId).dirs.add(path);
    this.addParents(userId, path);
  }

  async move(userId: string, from: string, to: string): Promise<void> {
    const { files, dirs } = this.tree(userId);
    if (files.has(from)) {
      files.set(to, files.get(from)!);
      files.delete(from);
      this.addParents(userId, to);
      return;
    }
    if (!dirs.has(from)) throw new Error(`Not found: ${from}`);
    for (const [path, entry] of [...files]) {
      if (path.startsWith(`${from}/`)) {
        files.delete(path);
        files.set(to + path.slice(from.length), entry);
      }
    }
    for (const dir of [...dirs]) {
      if (dir === from || dir.startsWith(`${from}/`)) {
        dirs.delete(dir);
        dirs.add(to + dir.slice(from.length));
      }
    }
    this.addParents(userId, to);
  }

  async delete(userId: string, path: string): Promise<void> {
    const { files, dirs } = this.tree(userId);
    if (files.delete(path)) return;
    if (!dirs.has(path)) throw new Error(`Not found: ${path}`);
    for (const file of [...files.keys()]) if (file.startsWith(`${path}/`)) files.delete(file);
    for (const dir of [...dirs]) if (dir === path || dir.startsWith(`${path}/`)) dirs.delete(dir);
  }

  async usage(userId: string): Promise<StorageArea[]> {
    const used = [...this.tree(userId).files.values()].reduce((n, f) => n + f.data.length, 0);
    return [{ name: 'workspace', usedBytes: used, limitBytes: this.limitBytes, note: this.note }];
  }
}
