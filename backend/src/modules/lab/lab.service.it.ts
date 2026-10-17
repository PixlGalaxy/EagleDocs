/**
 * The Accelerator Lab against a real Postgres (embedded, throwaway) and fake GPU servers:
 * fair order, priorities, units, limits, withdrawing, transcription and a single worker.
 * Slow (starts a database), so it is not in `npm test`: run `npm run test:lab`.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { createServer as netServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import type { Bus } from '../../bus/bus.js';
import type { SettingsService } from '../../db/settings.js';
import { runMigrations } from '../../db/migrate.js';
import { DiskWorkspace } from '../../engine/workspace.js';
import { SETTINGS_KEYS as K } from '../admin/settings-keys.js';
import type { TiersService } from '../billing/tiers.service.js';
import { LabError, LabService } from './lab.service.js';
import { AdminEmbeddings } from '../../engine/documents.js';
import { runAsUser } from '../../engine/run-user.js';

const dir = mkdtempSync(join(tmpdir(), 'studyhawk-lab-'));
let embedded: EmbeddedPostgres;
let db: pg.Pool;
let gpu: http.Server;
let gpuUrl = '';
/** What the fake GPU ran, in order. */
const ran: string[] = [];
const labs: LabService[] = [];

const settingsMap = new Map<string, unknown>();
const settings = {
  getBoolean: (k: string, d: boolean) => (settingsMap.has(k) ? Boolean(settingsMap.get(k)) : d),
  getString: (k: string, d: string) => (typeof settingsMap.get(k) === 'string' ? (settingsMap.get(k) as string) : d),
  getNumber: (k: string, d: number) => (typeof settingsMap.get(k) === 'number' ? (settingsMap.get(k) as number) : d),
} as unknown as SettingsService;
let dailyAu = 0;
const tiers = { limitsFor: async () => ({ acceleratorUnitsDaily: dailyAu, acceleratorUnitsWeekly: 0 }) } as unknown as TiersService;

/** NOTIFY in one process: every LabService here hears every publish, like replicas on one database. */
function fakeBus(): Bus {
  const handlers = new Map<string, Set<(p: unknown) => void>>();
  return {
    on: async (channel: string, handler: (p: unknown) => void) => {
      if (!handlers.has(channel)) handlers.set(channel, new Set());
      handlers.get(channel)!.add(handler);
      return () => handlers.get(channel)!.delete(handler);
    },
    publish: async (channel: string, payload: unknown) => {
      for (const handler of handlers.get(channel) ?? []) handler(payload);
    },
  } as unknown as Bus;
}
const bus = fakeBus();

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = netServer().listen(0, () => {
      const { port } = s.address() as AddressInfo;
      s.close(() => resolve(port));
    });
  });

async function user(name: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "INSERT INTO users (email, username, password_hash, status) VALUES ($1, $2, 'x', 'active') RETURNING id",
    [`${name}@test.edu`, name],
  );
  return rows[0]!.id;
}

const waitFor = async (check: () => Promise<boolean>, ms = 15_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('timed out');
};

before(async () => {
  const port = await freePort();
  embedded = new EmbeddedPostgres({
    databaseDir: join(dir, 'pg'),
    user: 'studyhawk',
    password: 'studyhawk',
    port,
    persistent: false,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    onLog: () => undefined,
    onError: () => undefined,
  });
  await embedded.initialise();
  await embedded.start();
  db = new pg.Pool({ connectionString: `postgres://studyhawk:studyhawk@127.0.0.1:${port}/postgres`, max: 10 });
  await db.query('CREATE EXTENSION IF NOT EXISTS citext').catch(() => undefined);
  await runMigrations(db);

  // The GPU: a chat answers with the prompt it got (after a beat), speech becomes two timed segments.
  gpu = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      setTimeout(() => {
        if (req.url === '/api/embed') {
          const { input } = JSON.parse(body) as { input: string[] };
          ran.push(`embed:${input.length}`);
          res.end(JSON.stringify({ embeddings: input.map((t) => [t.length, 1, 0]) }));
        } else if (req.url === '/api/chat') {
          const { model, messages } = JSON.parse(body) as { model: string; messages: { content: string; images?: string[] }[] };
          const prompt = messages.at(-1)!.content;
          ran.push(prompt);
          res.end(JSON.stringify({ message: { content: `${model} saw ${messages.at(-1)!.images?.length ?? 0} picture(s): ${prompt}` } }));
        } else if (req.url === '/v1/audio/transcriptions') {
          ran.push('transcribe');
          res.end(JSON.stringify({ text: 'hello class', language: 'en', segments: [{ start: 0, end: 1.5, text: 'hello' }, { start: 1.5, end: 3, text: 'class' }] }));
        } else {
          res.statusCode = 404;
          res.end('{}');
        }
      }, 40);
    });
  });
  await new Promise<void>((r) => gpu.listen(0, '127.0.0.1', r));
  gpuUrl = `http://127.0.0.1:${(gpu.address() as AddressInfo).port}`;
  settingsMap.set(K.labEnabled, true);
  settingsMap.set(K.labOllamaUrl, gpuUrl);
  settingsMap.set(K.labVisionModel, 'vision-3b');
  settingsMap.set(K.labTextModel, 'text-4b');
  settingsMap.set(K.labWhisperUrl, gpuUrl);
});

after(async () => {
  // Workers hold their lock connections: let them go first, or the pool never closes.
  await Promise.all(labs.map((l) => l.stop().catch(() => undefined)));
  await db?.end().catch(() => undefined);
  gpu?.close();
  await embedded?.stop().catch(() => undefined);
  rmSync(dir, { recursive: true, force: true });
  // The worker loops and lock checks hold timers; nothing else is left to wait for.
  setTimeout(() => process.exit(0), 100).unref();
});

function lab(node: string): LabService {
  const workspace = new DiskWorkspace(join(dir, 'data'), settings);
  const service = new LabService(db, bus, settings, tiers, workspace, node);
  labs.push(service);
  return service;
}

test('tasks queued before the worker starts run fairly: one per student in turn', async () => {
  const ana = await user('ana');
  const ben = await user('ben');
  const a = lab('node-a');
  const ids = [];
  for (let i = 1; i <= 3; i++) ids.push(await a.submit(ana, 'text', { prompt: `ana-${i}` }));
  ids.push(await a.submit(ben, 'text', { prompt: 'ben-1' }));
  ran.length = 0;
  await a.start();
  await Promise.all(ids.map((id) => a.wait(id)));
  // Ana's first was first in line; then Ben, served never, goes before Ana's second.
  assert.deepEqual(ran, ['ana-1', 'ben-1', 'ana-2', 'ana-3']);
});

test('a picture someone is waiting for goes ahead of batch work', async () => {
  const cara = await user('cara');
  const dan = await user('dan');
  const a = labs[0]!;
  ran.length = 0;
  const batch = [];
  for (let i = 1; i <= 4; i++) batch.push(await a.submit(cara, 'text', { prompt: `cara-${i}` }));
  const seen = await a.run(dan, 'vision', { prompt: 'dan-picture', data: Buffer.from('png').toString('base64') }, { priority: 0 });
  assert.match(seen.text, /vision-3b saw 1 picture\(s\): dan-picture/);
  await Promise.all(batch.map((id) => a.wait(id)));
  assert.ok(ran.indexOf('dan-picture') <= 1, `the picture ran at ${ran.indexOf('dan-picture')}: ${ran.join(', ')}`);
  // The picture is not kept once it ran.
  const { rows } = await db.query("SELECT input FROM lab_tasks WHERE input->>'prompt' = 'dan-picture'");
  assert.equal(rows[0].input.data, undefined);
});

test('GPU time counts as Accelerator Units, and a used-up day stops new work', async () => {
  const eve = await user('eve');
  const a = labs[0]!;
  await a.run(eve, 'text', { prompt: 'eve-1' });
  const { rows } = await db.query('SELECT used_ms FROM lab_windows WHERE user_id = $1 AND kind = $2', [eve, 'day']);
  assert.ok(Number(rows[0].used_ms) >= 30, `used ${rows[0].used_ms} ms`);
  const usage = await db.query('SELECT lab_ms FROM usage_daily WHERE user_id = $1', [eve]);
  assert.ok(Number(usage.rows[0].lab_ms) >= 30);

  dailyAu = 0.0001; // a fraction of a second
  try {
    const status = await a.status(eve);
    assert.equal(status.over, true);
    await assert.rejects(a.submit(eve, 'text', { prompt: 'eve-2' }), (err) => err instanceof LabError && /used up/.test(err.message));
  } finally {
    dailyAu = 0;
  }
});

test('giving up on a task that has not started withdraws it', async () => {
  const fay = await user('fay');
  const gus = await user('gus');
  const a = labs[0]!;
  // Keep the GPU busy so Fay's task waits.
  const busy = [];
  for (let i = 0; i < 5; i++) busy.push(await a.submit(gus, 'text', { prompt: `gus-${i}` }));
  const id = await a.submit(fay, 'text', { prompt: 'fay-never' });
  const stop = new AbortController();
  stop.abort();
  await assert.rejects(a.wait(id, stop.signal), /Stopped/);
  const { rowCount } = await db.query('SELECT 1 FROM lab_tasks WHERE id = $1', [id]);
  assert.equal(rowCount, 0);
  await Promise.all(busy.map((t) => a.wait(t)));
});

test('RAG embeddings go through the queue as the run\'s student, and a search still works on used-up units', async () => {
  const kim = await user('kim');
  const a = labs[0]!;
  settingsMap.set(K.labEmbedModel, 'embed-0.6b');
  const embeddings = new AdminEmbeddings(db, {} as never);
  embeddings.useLab(a);
  try {
    await embeddings.refresh();
    assert.equal(embeddings.model, 'embed-0.6b');
    const vectors = await runAsUser(kim, () => embeddings.embed(['alpha', 'be']));
    assert.deepEqual(vectors, [[5, 1, 0], [2, 1, 0]]);
    const { rows } = await db.query("SELECT user_id, priority, output FROM lab_tasks WHERE kind = 'embed' AND user_id = $1", [kim]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].priority, 1);
    assert.equal(rows[0].output, null, 'the vectors are not kept once read');

    dailyAu = 0.0001;
    await runAsUser(kim, () => embeddings.embed(['used units'])).catch(() => undefined);
    // Over the limit now: a batch is refused, one query still runs (and goes ahead of batch work).
    await assert.rejects(runAsUser(kim, () => embeddings.embed(['a', 'b'])), /used up/);
    assert.equal((await runAsUser(kim, () => embeddings.embed(['where is the quiz?']))).length, 1);
    const query = await db.query("SELECT priority FROM lab_tasks WHERE kind = 'embed' AND user_id = $1 ORDER BY created_at DESC LIMIT 1", [kim]);
    assert.equal(query.rows[0].priority, 0);
  } finally {
    dailyAu = 0;
    settingsMap.delete(K.labEmbedModel);
  }
});

test('the same lecture piece from a classmate comes from the cache: no GPU, no units, no wait', async () => {
  const leo = await user('leo');
  const mia = await user('mia');
  for (const u of [leo, mia]) {
    mkdirSync(join(dir, 'data', 'workspaces', u, 'Class'), { recursive: true });
    writeFileSync(join(dir, 'data', 'workspaces', u, 'Class', 'piece.wav'), Buffer.from('the same recording'));
  }
  const a = labs[0]!;
  await a.run(leo, 'transcribe', { path: 'Class/piece.wav' });
  const before = ran.length;
  const out = await a.run(mia, 'transcribe', { path: 'Class/piece.wav' });
  assert.equal(out.text, 'hello class');
  assert.equal(ran.length, before, 'the GPU was not used');
  const { rows } = await db.query("SELECT gpu_ms FROM lab_tasks WHERE user_id = $1 AND kind = 'transcribe'", [mia]);
  assert.equal(rows[0].gpu_ms, 0);
  assert.equal((await db.query('SELECT 1 FROM lab_windows WHERE user_id = $1', [mia])).rowCount, 0, 'no units counted');
  // Different bytes, different answer.
  writeFileSync(join(dir, 'data', 'workspaces', mia, 'Class', 'piece.wav'), Buffer.from('another recording'));
  await a.run(mia, 'transcribe', { path: 'Class/piece.wav' });
  assert.equal(ran.length, before + 1);
  // The wait estimate uses the GPU time of the last hour.
  const eta = await a.eta(mia);
  assert.equal(eta.ahead, 0);
  assert.equal(eta.seconds, 0);
});

test('speech comes back as timed segments', async () => {
  const hal = await user('hal');
  mkdirSync(join(dir, 'data', 'workspaces', hal, 'Lectures'), { recursive: true });
  writeFileSync(join(dir, 'data', 'workspaces', hal, 'Lectures', 'part-001.wav'), Buffer.alloc(64));
  const out = await labs[0]!.run(hal, 'transcribe', { path: 'Lectures/part-001.wav' });
  assert.equal(out.text, 'hello class');
  assert.deepEqual(out.segments.map((s) => [s.start, s.text]), [[0, 'hello'], [1.5, 'class']]);
});

test('one worker in the cluster: a second replica waits, and takes over when the first is gone', async () => {
  const b = lab('node-b');
  await b.start();
  const ivy = await user('ivy');
  await labs[0]!.run(ivy, 'text', { prompt: 'ivy-1' });
  const { rows } = await db.query("SELECT DISTINCT node_id FROM lab_tasks WHERE status = 'done' AND node_id IS NOT NULL");
  assert.deepEqual(rows.map((r) => r.node_id), ['node-a']);

  // node-a shuts down (an update): it lets the lock go, and node-b's next check takes the worker.
  await labs[0]!.stop();
  const id = await b.submit(ivy, 'text', { prompt: 'ivy-2' });
  await waitFor(async () => (await db.query("SELECT 1 FROM lab_tasks WHERE id = $1 AND status = 'done'", [id])).rowCount === 1, 30_000);
  const done = await db.query('SELECT node_id FROM lab_tasks WHERE id = $1', [id]);
  assert.equal(done.rows[0].node_id, 'node-b');
});

test('a worker whose database connection dies loses the queue to a live replica', async () => {
  const c = lab('node-c');
  await c.start();
  const jo = await user('jo');
  // node-b crashes: its lock connection is cut without a goodbye.
  await db.query("SELECT pg_terminate_backend(pid) FROM pg_locks WHERE locktype = 'advisory' AND objid = $1", [0x1ab0_0001]);
  const id = await c.submit(jo, 'text', { prompt: 'jo-1' });
  await waitFor(async () => (await db.query("SELECT 1 FROM lab_tasks WHERE id = $1 AND status = 'done'", [id])).rowCount === 1, 30_000);
  // Whoever took it, exactly one worker holds the lock now.
  const { rows } = await db.query("SELECT COUNT(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND objid = $1 AND granted", [0x1ab0_0001]);
  assert.equal(rows[0].n, 1);
});
