import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Db } from '../../db/pool.js';
import type { SettingsService } from '../../db/settings.js';
import { DiskWorkspace } from '../../engine/workspace.js';
import { ExportService } from './export.service.js';
import type { ZipEntry } from './zip-stream.js';

const USER = '0b6f3c1e-5d2a-4c1b-9a8e-1f2d3c4b5a69';

async function contentOf(entry: ZipEntry): Promise<string> {
  if (entry.data !== undefined) return entry.data.toString();
  const source = await entry.open!();
  assert.ok(source);
  const parts: Buffer[] = [];
  for await (const chunk of source.stream) parts.push(chunk);
  await source.close?.();
  return Buffer.concat(parts).toString();
}

test('the export walks the workspace and TEMP, skipping .browser, .rag, partial uploads and links', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'studyhawk-export-'));
  const settings = { getNumber: (_key: string, fallback: number) => fallback } as unknown as SettingsService;
  const ws = new DiskWorkspace(root, settings);
  await ws.write(USER, 'Fall 2026/ACG 2021/notes.md', '# Notes');
  await ws.write(USER, 'Économie/résumé ñ.txt', 'é');
  await ws.write(USER, 'photo.png', 'not really a png');
  await ws.write(USER, 'TEMP/download.txt', 'temp');
  await ws.mkdir(USER, 'empty');
  const home = join(root, 'workspaces', USER);
  await fs.mkdir(join(home, '.browser'), { recursive: true });
  await fs.writeFile(join(home, '.browser', 'cookies'), 'secret');
  await fs.mkdir(join(home, '.rag', 'c1'), { recursive: true });
  await fs.writeFile(join(home, '.rag', 'c1', 'index.json'), '{}');
  await fs.writeFile(join(home, 'upload.pdf.0123456789abcdef.part'), 'x');
  // Links planted by the sandbox, pointing outside the root: never followed (junctions need no rights on Windows).
  const outside = await fs.mkdtemp(join(tmpdir(), 'studyhawk-outside-'));
  await fs.writeFile(join(outside, 'secret.txt'), 'outside');
  const linked = await fs.symlink(outside, join(home, 'link-dir'), 'junction').then(() => true, () => false);
  await fs.symlink(join(outside, 'secret.txt'), join(home, 'link.txt'), 'file').catch(() => undefined);

  const data = { profile: { username: 'user' }, connections: [], pushDevices: 0, schedules: [], skills: [], docs: [], imageNotes: [], chats: [] };
  const entries: ZipEntry[] = [];
  for await (const e of new ExportService(undefined as unknown as Db, ws).entries(USER, data)) entries.push(e);
  const names = entries.map((e) => e.name);
  assert.deepEqual(
    names.filter((n) => n.startsWith('files/')).sort(),
    [
      'files/Fall 2026/',
      'files/Fall 2026/ACG 2021/',
      'files/Fall 2026/ACG 2021/notes.md',
      'files/TEMP/',
      'files/TEMP/download.txt',
      'files/empty/',
      'files/photo.png',
      'files/Économie/',
      'files/Économie/résumé ñ.txt',
    ].sort(),
  );
  assert.deepEqual(names.slice(0, 2), ['README.txt', 'data.json']);
  const byName = new Map(entries.map((e) => [e.name, e]));
  assert.equal(await contentOf(byName.get('files/Fall 2026/ACG 2021/notes.md')!), '# Notes');
  assert.equal(await contentOf(byName.get('files/TEMP/download.txt')!), 'temp');
  assert.equal(byName.get('files/photo.png')!.compress, false);
  assert.equal(byName.get('files/Fall 2026/ACG 2021/notes.md')!.compress, true);
  if (linked) assert.ok(!names.some((n) => n.includes('link')));
  const json = JSON.parse(String(byName.get('data.json')!.data));
  assert.equal(json.profile.username, 'user');
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(outside, { recursive: true, force: true });
});
