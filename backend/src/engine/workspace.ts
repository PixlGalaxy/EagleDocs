import { createWriteStream, promises as fs } from 'fs';
import { dirname, join, relative, resolve, sep } from 'path';
import { pipeline } from 'stream/promises';
import type { Readable } from 'stream';
import type { FileEntry, StorageArea, WorkspacePort } from 'pixlai-engine';
import type { SettingsService } from '../db/settings.js';
import { logger } from '../logger.js';

export const TEMP = 'TEMP';
export const TEMP_TTL_MS = 24 * 60 * 60 * 1000;
const USAGE_TTL_MS = 30_000;
const MB = 1024 * 1024;

type Area = 'workspace' | 'temp';

/** A path the user may touch, resolved to disk. */
interface Resolved {
  area: Area;
  root: string;
  abs: string;
  /** Path relative to the area root ("" for the root itself). */
  rel: string;
}

export class QuotaError extends Error {}

/**
 * Each user's files on the shared storage (`/data`), seen by every replica and,
 * in phase 4, mounted into their sandbox:
 *   /data/workspaces/<userId>/   the workspace, quota from settings (5 GB by default)
 *   /data/temp/<userId>/         shown as "TEMP/", its own quota (10 GB); files expire 24 h after their last change
 */
export class DiskWorkspace implements WorkspacePort {
  private usageCache = new Map<string, { at: number; bytes: number }>();

  constructor(
    private dataRoot: string,
    private settings: SettingsService,
  ) {}

  limits(): Record<Area, number> {
    return {
      workspace: this.settings.getNumber('sandbox.default_disk_mb', 5120) * MB,
      temp: this.settings.getNumber('storage.temp_mb', 10240) * MB,
    };
  }

  rootOf(userId: string, area: Area): string {
    if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error('Invalid user');
    return join(this.dataRoot, area === 'workspace' ? 'workspaces' : 'temp', userId);
  }

  /** Maps "TEMP/..." to the temp area and refuses anything that would leave the user's roots. */
  resolve(userId: string, path: string): Resolved {
    const clean = path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (clean.split('/').some((p) => p === '..' || p === '.')) throw new Error('Invalid path');
    const isTemp = clean === TEMP || clean.startsWith(`${TEMP}/`);
    const area: Area = isTemp ? 'temp' : 'workspace';
    const rel = isTemp ? clean.slice(TEMP.length).replace(/^\//, '') : clean;
    const root = this.rootOf(userId, area);
    const abs = resolve(root, rel);
    if (abs !== root && !abs.startsWith(root + sep)) throw new Error('Invalid path');
    return { area, root, abs, rel };
  }

  private visible(area: Area, rel: string): string {
    const posix = rel.split(sep).join('/');
    return area === 'temp' ? (posix ? `${TEMP}/${posix}` : TEMP) : posix;
  }

  /** Refuses symlinks anywhere on the way, so a link can never point outside the user's root. */
  private async assertNoLinks(r: Resolved): Promise<void> {
    let current = r.root;
    for (const part of r.rel.split('/').filter(Boolean)) {
      current = join(current, part);
      const stat = await fs.lstat(current).catch(() => null);
      if (!stat) return;
      if (stat.isSymbolicLink()) throw new Error('Links are not allowed in the workspace');
    }
  }

  private async ensureRoot(userId: string, area: Area): Promise<void> {
    await fs.mkdir(this.rootOf(userId, area), { recursive: true });
  }

  async describe(userId: string): Promise<string> {
    const areas = await this.usage(userId);
    const ws = areas[0]!;
    const temp = areas[1]!;
    const gb = (b: number) => `${(b / 1024 ** 3).toFixed(1)} GB`;
    return [
      `The user's private files. Workspace: ${gb(ws.usedBytes)} of ${gb(ws.limitBytes)} used. Organize it in folders,`,
      'e.g. "Fall 2026/ACG 2021/" for notes, summaries and study material.',
      `TEMP/ is a separate ${gb(temp.limitBytes)} area for downloads and intermediate files: every file there is deleted`,
      'permanently 24 hours after its last change. Put raw downloads there; move anything worth keeping out of TEMP/ in time.',
      'RAG collections (rag_ tools) count toward the workspace quota; after building one, the source files can be deleted.',
      'The user also sees these files on the Files page.',
    ].join(' ');
  }

  async list(userId: string, path: string): Promise<FileEntry[]> {
    const r = this.resolve(userId, path);
    await this.ensureRoot(userId, r.area);
    await this.assertNoLinks(r);
    const dirents = await fs.readdir(r.abs, { withFileTypes: true }).catch((err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') throw new Error(`Not found: ${path || '/'}`);
      if (err.code === 'ENOTDIR') throw new Error(`Not a folder: ${path}`);
      throw err;
    });
    const out: FileEntry[] = [];
    for (const d of dirents) {
      if (d.isSymbolicLink()) continue;
      const abs = join(r.abs, d.name);
      const stat = await fs.stat(abs).catch(() => null);
      if (!stat) continue;
      out.push({
        path: this.visible(r.area, relative(r.root, abs)),
        name: d.name,
        type: d.isDirectory() ? 'dir' : 'file',
        size: d.isDirectory() ? 0 : stat.size,
        modifiedAt: stat.mtime.toISOString(),
      });
    }
    // TEMP lives elsewhere on disk but shows as a folder at the root.
    if (r.area === 'workspace' && r.rel === '') {
      await this.ensureRoot(userId, 'temp');
      const stat = await fs.stat(this.rootOf(userId, 'temp'));
      out.push({ path: TEMP, name: TEMP, type: 'dir', size: 0, modifiedAt: stat.mtime.toISOString() });
    }
    return out.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
  }

  async stat(userId: string, path: string): Promise<FileEntry | null> {
    const r = this.resolve(userId, path);
    await this.assertNoLinks(r);
    const stat = await fs.stat(r.abs).catch(() => null);
    if (!stat) return null;
    return {
      path: this.visible(r.area, r.rel),
      name: r.rel.split('/').pop() || (r.area === 'temp' ? TEMP : ''),
      type: stat.isDirectory() ? 'dir' : 'file',
      size: stat.isDirectory() ? 0 : stat.size,
      modifiedAt: stat.mtime.toISOString(),
    };
  }

  async read(userId: string, path: string): Promise<Buffer> {
    const r = this.resolve(userId, path);
    await this.assertNoLinks(r);
    const stat = await fs.stat(r.abs).catch(() => null);
    if (!stat) throw new Error(`Not found: ${path}`);
    if (stat.isDirectory()) throw new Error(`${path} is a folder`);
    if (stat.size > 200 * MB) throw new Error('File is too large to read here (over 200 MB)');
    return fs.readFile(r.abs);
  }

  /** Throws QuotaError when `extra` bytes would not fit in the area. */
  async assertFits(userId: string, area: Area, extra: number): Promise<void> {
    if (extra <= 0) return;
    const used = await this.areaBytes(userId, area);
    const limit = this.limits()[area];
    if (used + extra > limit) {
      const free = Math.max(0, limit - used);
      throw new QuotaError(
        `Not enough space in ${area === 'temp' ? 'TEMP' : 'the workspace'}: ${(extra / MB).toFixed(1)} MB needed, ${(free / MB).toFixed(1)} MB free. Delete files first.`,
      );
    }
  }

  async write(userId: string, path: string, data: Buffer | string, options?: { append?: boolean }): Promise<void> {
    const r = this.resolve(userId, path);
    if (!r.rel) throw new Error('A file name is required');
    await this.assertNoLinks(r);
    const bytes = typeof data === 'string' ? Buffer.byteLength(data) : data.length;
    const previous = options?.append ? 0 : ((await fs.stat(r.abs).catch(() => null))?.size ?? 0);
    await this.assertFits(userId, r.area, bytes - previous);
    await fs.mkdir(dirname(r.abs), { recursive: true });
    if (options?.append) await fs.appendFile(r.abs, data);
    else await fs.writeFile(r.abs, data);
    this.forgetUsage(userId);
  }

  /** Streams an upload or download to disk, stopping when it exceeds `maxBytes` or the quota. */
  async writeStream(userId: string, path: string, stream: Readable, maxBytes: number): Promise<number> {
    const r = this.resolve(userId, path);
    if (!r.rel) throw new Error('A file name is required');
    await this.assertNoLinks(r);
    const free = this.limits()[r.area] - (await this.areaBytes(userId, r.area));
    const cap = Math.min(maxBytes, free);
    await fs.mkdir(dirname(r.abs), { recursive: true });
    const partial = `${r.abs}.${process.pid}.part`;
    let written = 0;
    try {
      await pipeline(
        stream,
        async function* limit(source: AsyncIterable<Buffer>) {
          for await (const chunk of source) {
            written += chunk.length;
            if (written > cap) {
              throw new QuotaError(written > maxBytes ? 'The file is too large' : 'Not enough space for this file. Delete files first.');
            }
            yield chunk;
          }
        },
        createWriteStream(partial),
      );
      await fs.rename(partial, r.abs);
    } catch (err) {
      await fs.rm(partial, { force: true }).catch(() => undefined);
      throw err;
    } finally {
      this.forgetUsage(userId);
    }
    return written;
  }

  async mkdir(userId: string, path: string): Promise<void> {
    const r = this.resolve(userId, path);
    await this.assertNoLinks(r);
    await fs.mkdir(r.abs, { recursive: true });
  }

  async move(userId: string, from: string, to: string): Promise<void> {
    const a = this.resolve(userId, from);
    const b = this.resolve(userId, to);
    if (!a.rel) throw new Error('Cannot move a root folder');
    await this.assertNoLinks(a);
    await this.assertNoLinks(b);
    const stat = await fs.stat(a.abs).catch(() => null);
    if (!stat) throw new Error(`Not found: ${from}`);
    if (await fs.stat(b.abs).catch(() => null)) throw new Error(`${to} already exists`);
    if (a.area !== b.area) await this.assertFits(userId, b.area, stat.isDirectory() ? await dirBytes(a.abs) : stat.size);
    await fs.mkdir(dirname(b.abs), { recursive: true });
    try {
      await fs.rename(a.abs, b.abs);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
      await fs.cp(a.abs, b.abs, { recursive: true });
      await fs.rm(a.abs, { recursive: true, force: true });
    }
    // Entering TEMP starts its 24 h clock now, not from the file's old date.
    if (b.area === 'temp' && a.area !== 'temp') await touchTree(b.abs);
    this.forgetUsage(userId);
  }

  async delete(userId: string, path: string): Promise<void> {
    const r = this.resolve(userId, path);
    if (!r.rel) throw new Error('Cannot delete a root folder');
    await this.assertNoLinks(r);
    if (!(await fs.stat(r.abs).catch(() => null))) throw new Error(`Not found: ${path}`);
    await fs.rm(r.abs, { recursive: true, force: true });
    this.forgetUsage(userId);
  }

  async usage(userId: string): Promise<StorageArea[]> {
    const limits = this.limits();
    return [
      { name: 'workspace', usedBytes: await this.areaBytes(userId, 'workspace'), limitBytes: limits.workspace },
      {
        name: TEMP,
        usedBytes: await this.areaBytes(userId, 'temp'),
        limitBytes: limits.temp,
        note: 'Files are deleted permanently 24 hours after their last change.',
      },
    ];
  }

  private forgetUsage(userId: string): void {
    this.usageCache.delete(`${userId}:workspace`);
    this.usageCache.delete(`${userId}:temp`);
  }

  async areaBytes(userId: string, area: Area): Promise<number> {
    const key = `${userId}:${area}`;
    const hit = this.usageCache.get(key);
    if (hit && Date.now() - hit.at < USAGE_TTL_MS) return hit.bytes;
    const bytes = await dirBytes(this.rootOf(userId, area));
    this.usageCache.set(key, { at: Date.now(), bytes });
    return bytes;
  }
}

async function dirBytes(dir: string): Promise<number> {
  let total = 0;
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) total += await dirBytes(abs);
    else if (entry.isFile()) total += (await fs.stat(abs).catch(() => ({ size: 0 }))).size;
  }
  return total;
}

async function touchTree(path: string): Promise<void> {
  const now = new Date();
  const stat = await fs.stat(path);
  if (stat.isDirectory()) {
    for (const entry of await fs.readdir(path)) await touchTree(join(path, entry));
  }
  await fs.utimes(path, now, now);
}

/**
 * Leader task: deletes TEMP files 24 h after their last change, then empty
 * folders. Runs over every user's TEMP on the shared storage.
 */
export async function sweepTemp(dataRoot: string, now = Date.now()): Promise<{ files: number; bytes: number }> {
  const base = join(dataRoot, 'temp');
  let files = 0;
  let bytes = 0;
  const visit = async (dir: string, isUserRoot: boolean): Promise<boolean> => {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    let empty = true;
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (await visit(abs, false)) await fs.rmdir(abs).catch(() => undefined);
        else empty = false;
        continue;
      }
      const stat = await fs.lstat(abs).catch(() => null);
      if (stat && now - stat.mtimeMs > TEMP_TTL_MS) {
        await fs.rm(abs, { force: true });
        files++;
        bytes += stat.size;
      } else {
        empty = false;
      }
    }
    return empty && !isUserRoot;
  };
  for (const user of await fs.readdir(base, { withFileTypes: true }).catch(() => [])) {
    if (user.isDirectory()) await visit(join(base, user.name), true);
  }
  if (files) logger.info(`TEMP sweep: deleted ${files} expired file(s), ${(bytes / MB).toFixed(1)} MB`);
  return { files, bytes };
}
