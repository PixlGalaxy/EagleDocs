import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { SettingsService } from '../db/settings.js';
import { DiskWorkspace, QuotaError, sweepTemp, TEMP_TTL_MS } from './workspace.js';

const USER = '0b6f3c1e-5d2a-4c1b-9a8e-1f2d3c4b5a69';
const HOUR = 3_600_000;

/** Workspace of 1 MB and TEMP of 2 MB, in a fresh folder. */
async function setup() {
  const root = await fs.mkdtemp(join(tmpdir(), 'studyhawk-ws-'));
  const settings = { getNumber: (key: string, fallback: number) => (key === 'sandbox.default_disk_mb' ? 1 : key === 'storage.temp_mb' ? 2 : fallback) };
  return { root, ws: new DiskWorkspace(root, settings as unknown as SettingsService) };
}

test('TEMP/ maps to its own area with its own quota and rules', async () => {
  const { root, ws } = await setup();
  await ws.write(USER, 'Fall 2026/ACG 2021/notes.md', '# Notes');
  await ws.write(USER, 'TEMP/canvas/slides.txt', 'x'.repeat(1500 * 1024));
  assert.equal((await fs.readFile(join(root, 'temp', USER, 'canvas', 'slides.txt'))).length, 1500 * 1024);
  assert.equal((await fs.readFile(join(root, 'workspaces', USER, 'Fall 2026', 'ACG 2021', 'notes.md'), 'utf8')), '# Notes');

  const root_ = await ws.list(USER, '');
  assert.deepEqual(root_.map((e) => e.path).sort(), ['Fall 2026', 'TEMP']);
  assert.deepEqual((await ws.list(USER, 'TEMP/canvas')).map((e) => e.path), ['TEMP/canvas/slides.txt']);

  // 1.5 MB fits in TEMP (2 MB) but would not in the 1 MB workspace.
  await assert.rejects(ws.move(USER, 'TEMP/canvas/slides.txt', 'Fall 2026/slides.txt'), QuotaError);
  await assert.rejects(ws.write(USER, 'TEMP/more.txt', 'y'.repeat(600 * 1024)), QuotaError);

  const [workspace, temp] = await ws.usage(USER);
  assert.equal(workspace!.limitBytes, 1024 * 1024);
  assert.equal(temp!.limitBytes, 2 * 1024 * 1024);
  assert.match(await ws.describe(USER), /deleted\s+permanently 24 hours after its last change/);
});

test('paths cannot leave the user root', async () => {
  const { root, ws } = await setup();
  for (const bad of ['../other/x.txt', 'a/../../x', 'TEMP/../../x', './x']) {
    await assert.rejects(ws.write(USER, bad, 'x'), /Invalid path/, bad);
  }
  assert.throws(() => ws.rootOf('../../etc', 'workspace'), /Invalid user/);

  // A link inside the workspace pointing elsewhere is refused (junctions need no admin rights on Windows).
  const outside = join(root, 'outside');
  await fs.mkdir(outside);
  await fs.writeFile(join(outside, 'secret.txt'), 'secret');
  await fs.mkdir(join(root, 'workspaces', USER), { recursive: true });
  const linked = await fs.symlink(outside, join(root, 'workspaces', USER, 'link'), 'junction').then(() => true, () => false);
  if (linked) {
    await assert.rejects(ws.read(USER, 'link/secret.txt'), /Links are not allowed/);
    await assert.rejects(ws.write(USER, 'link/new.txt', 'x'), /Links are not allowed/);
  }
});

test('the sweep deletes TEMP files 24 h after their last change, then empty folders', async () => {
  const { root, ws } = await setup();
  await ws.write(USER, 'TEMP/old/a.pdf', 'old');
  await ws.write(USER, 'TEMP/fresh/b.pdf', 'fresh');
  await ws.write(USER, 'kept.md', 'workspace files are never swept');
  const old = new Date(Date.now() - TEMP_TTL_MS - HOUR);
  await fs.utimes(join(root, 'temp', USER, 'old', 'a.pdf'), old, old);

  const result = await sweepTemp(root);
  assert.equal(result.files, 1);
  assert.equal(await ws.stat(USER, 'TEMP/old/a.pdf'), null);
  assert.equal(await ws.stat(USER, 'TEMP/old'), null, 'empty folder removed');
  assert.ok(await ws.stat(USER, 'TEMP/fresh/b.pdf'));
  assert.ok(await ws.stat(USER, 'kept.md'));
  assert.ok(await ws.stat(USER, 'TEMP'), 'the TEMP root itself stays');

  // A day later the fresh file goes too.
  assert.equal((await sweepTemp(root, Date.now() + TEMP_TTL_MS + HOUR)).files, 1);
  assert.equal(await ws.stat(USER, 'TEMP/fresh/b.pdf'), null);
});

test('moving a file into TEMP restarts its 24 h clock', async () => {
  const { root, ws } = await setup();
  await ws.write(USER, 'draft.md', 'draft');
  const old = new Date(Date.now() - 3 * TEMP_TTL_MS);
  await fs.utimes(join(root, 'workspaces', USER, 'draft.md'), old, old);
  await ws.move(USER, 'draft.md', 'TEMP/draft.md');
  assert.equal((await sweepTemp(root)).files, 0, 'not deleted right after the move');
});
