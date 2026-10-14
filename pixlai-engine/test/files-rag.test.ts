import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  chunkPages,
  createEngine,
  InMemoryMemoryStore,
  InMemoryRunStore,
  InMemoryScheduleStore,
  InMemorySkillStore,
  InMemoryWorkspace,
  type EmbeddingPort,
  type SharedRagSource,
  type TextExtractor,
} from '../src/index.js';
import { model, ScriptedProvider, text, toolCall } from './helpers.js';

const user = (content: string) => ({ role: 'user' as const, content });
const profile = { id: 'u1', name: 'Ana', language: 'en', timezone: 'UTC' };

/** Bag-of-words embeddings: deterministic, and texts sharing words land close together. */
class WordEmbeddings implements EmbeddingPort {
  readonly model = 'test-words';
  calls = 0;
  async embed(texts: string[]): Promise<number[][]> {
    this.calls++;
    return texts.map((t) => {
      const v = new Array(64).fill(0);
      for (const word of t.toLowerCase().match(/[a-z]{3,}/g) ?? []) {
        let h = 0;
        for (const ch of word) h = (h * 31 + ch.charCodeAt(0)) % 64;
        v[h] += 1;
      }
      return v;
    });
  }
}

/** Pretends to read "PDFs": `%PDF` + pages separated by form feeds. */
const pdfExtractor: TextExtractor = {
  async extract(data, filename) {
    if (!filename.endsWith('.pdf')) return null;
    return { pages: data.toString('utf8').replace(/^%PDF\n/, '').split('\f') };
  },
};

function setup(extra: { shared?: SharedRagSource; quota?: number } = {}) {
  const workspace = new InMemoryWorkspace(extra.quota ?? 5_000_000, 'Files in TEMP/ are deleted after 24 h.');
  const embeddings = new WordEmbeddings();
  const engine = createEngine({
    stores: { runs: new InMemoryRunStore(), memory: new InMemoryMemoryStore(), skills: new InMemorySkillStore(), schedules: new InMemoryScheduleStore() },
    basePrompt: 'You are TestBot.',
    workspace,
    embeddings,
    extractor: pdfExtractor,
    sharedRags: extra.shared,
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
  });
  const sink = { emit: () => undefined };
  return { agent: engine.forUser(profile), workspace, embeddings, sink, engine };
}

const lastTool = (provider: ScriptedProvider, n = 1) => provider.requests[n]!.messages.at(-1)!.content;
/** Tool results of the latest step only (after the last assistant message). */
const stepResults = (provider: ScriptedProvider, n: number) => {
  const messages = provider.requests[n]!.messages;
  const last = messages.map((m) => m.role).lastIndexOf('assistant');
  return messages.slice(last + 1).filter((m) => m.role === 'tool').map((m) => m.content);
};

test('files: folders, write, read in parts, search, move, delete, usage', async () => {
  const { agent, workspace, sink } = setup();
  const long = 'x'.repeat(20_000) + 'END';
  const provider = new ScriptedProvider([
    () => [
      ...toolCall('files_mkdir', { path: 'Fall 2026/ACG 2021' }, 'a'),
      ...toolCall('files_write', { path: 'Fall 2026/ACG 2021/notes.md', content: 'Chapter 4: accruals and deferrals' }, 'b'),
      ...toolCall('files_write', { path: '/Fall 2026/long.txt', content: long }, 'c'),
    ],
    () => [
      ...toolCall('files_list', { path: '', recursive: true }, 'd'),
      ...toolCall('files_read', { path: 'Fall 2026/long.txt' }, 'e'),
      ...toolCall('files_read', { path: 'Fall 2026/long.txt', offset: 15_000 }, 'f'),
      ...toolCall('files_search', { query: 'deferrals', in_content: true }, 'g'),
    ],
    () => [...toolCall('files_move', { from: 'Fall 2026/long.txt', to: 'TEMP/long.txt' }, 'h'), ...toolCall('files_delete', { path: 'TEMP/long.txt' }, 'i'), ...toolCall('files_usage', {}, 'j')],
    () => text('done'),
  ]);
  await agent.run({ runId: 'r1', model: model(provider), history: [user('organize')], sink });
  const step2 = stepResults(provider, 2);
  assert.match(step2[0]!, /Fall 2026\/ACG 2021\/notes\.md/);
  assert.match(step2[1]!, /"next_offset": 15000/);
  assert.match(step2[2]!, /END/);
  assert.doesNotMatch(step2[2]!, /next_offset/);
  assert.match(step2[3]!, /"line": 1/);
  assert.match(stepResults(provider, 3).at(-1)!, /"area": "workspace"/);
  assert.equal(await workspace.stat('u1', 'TEMP/long.txt'), null);
  assert.ok(await workspace.stat('u1', 'Fall 2026/ACG 2021/notes.md'));
  // The workspace rules reach the model.
  assert.match(provider.requests[0]!.messages[0]!.content, /## Workspace\nYour files\. Quota 5 MB\. Files in TEMP\/ are deleted after 24 h\./);
});

test('files: .rag is protected, ".." is refused, quota is enforced', async () => {
  const { agent, sink } = setup({ quota: 100 });
  const provider = new ScriptedProvider([
    () => [
      ...toolCall('files_write', { path: '.rag/x/manifest.json', content: '{}' }, 'a'),
      ...toolCall('files_read', { path: '../etc/passwd' }, 'b'),
      ...toolCall('files_write', { path: 'big.txt', content: 'y'.repeat(200) }, 'c'),
    ],
    () => text('ok'),
  ]);
  await agent.run({ runId: 'r1', model: model(provider), history: [user('x')], sink });
  const results = stepResults(provider, 1);
  assert.match(results[0]!, /managed by the rag_ tools/);
  assert.match(results[1]!, /cannot contain/);
  assert.match(results[2]!, /quota is full/);
});

test('documents are read through the extractor with pages', async () => {
  const { agent, workspace, sink } = setup();
  await workspace.write('u1', 'TEMP/book.pdf', '%PDF\nIntro page\fChapter one text');
  const provider = new ScriptedProvider([() => [...toolCall('files_read', { path: 'TEMP/book.pdf', page: 2 }, 'a'), ...toolCall('files_read', { path: 'TEMP/book.pdf' }, 'b')], () => text('ok')]);
  await agent.run({ runId: 'r1', model: model(provider), history: [user('read')], sink });
  const [one, all] = stepResults(provider, 1);
  assert.match(one!, /Chapter one text/);
  assert.doesNotMatch(one!, /Intro page/);
  assert.match(all!, /--- page 1 ---[\s\S]*--- page 2 ---/);
});

test('chunking splits long pages with overlap and keeps page numbers', () => {
  const page = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} talks about revenue recognition.`).join(' ');
  const chunks = chunkPages(['short intro text here', page]);
  assert.equal(chunks[0]!.page, 1);
  assert.ok(chunks.length >= 3);
  assert.ok(chunks.slice(1).every((c) => c.page === 2 && c.text.length <= 1200));
});

test('rag: build from a folder, search, ask with citations, survives deleting the sources', async () => {
  const { agent, workspace, embeddings, sink } = setup();
  await workspace.write('u1', 'TEMP/acg/ch4.pdf', '%PDF\nAccrual accounting records revenue when earned.\fDeferred revenue is a liability until earned.');
  await workspace.write('u1', 'TEMP/acg/ch5.txt', 'Inventory costing uses FIFO or LIFO methods for the cost of goods sold.');
  const provider = new ScriptedProvider([
    () => [...toolCall('rag_create', { name: 'ACG 2021 textbook', description: 'Chapters 4-5' }, 'a'), ...toolCall('rag_add', { rag: 'ACG 2021 textbook', paths: ['TEMP/acg'] }, 'b')],
    () => [...toolCall('files_delete', { path: 'TEMP/acg' }, 'c'), ...toolCall('rag_search', { rag: 'acg-2021-textbook', query: 'inventory FIFO costing', k: 2 }, 'd')],
    () => toolCall('rag_ask', { rag: 'acg-2021-textbook', question: 'What is deferred revenue?' }, 'e'),
    (req) => {
      // The standalone rag_ask call: only the excerpts, no tools.
      assert.equal(req.tools, undefined);
      assert.match(req.messages[1]!.content, /Deferred revenue is a liability/);
      return text('Deferred revenue is a liability until it is earned [1].');
    },
    () => toolCall('rag_list', {}, 'f'),
    () => text('done'),
  ]);
  await agent.run({ runId: 'r1', model: model(provider), history: [user('study')], sink });

  const built = JSON.parse(stepResults(provider, 1)[1]!);
  assert.deepEqual(built.added.map((a: { path: string }) => a.path).sort(), ['TEMP/acg/ch4.pdf', 'TEMP/acg/ch5.txt']);
  assert.equal(built.added.find((a: { path: string }) => a.path.endsWith('.pdf')).pages, 2);

  const searched = JSON.parse(provider.requests[2]!.messages.at(-1)!.content.replace(/^<untrusted_content[^>]*>\n|\n<\/untrusted_content>$/g, ''));
  assert.match(searched[0].text, /FIFO/);
  assert.equal(searched[0].source, 'TEMP/acg/ch5.txt');

  const asked = JSON.parse(lastTool(provider, 4));
  assert.equal(asked.answer, 'Deferred revenue is a liability until it is earned [1].');
  assert.equal(asked.sources[0].source, 'TEMP/acg/ch4.pdf');
  assert.equal(asked.sources[0].page, 2);

  assert.match(lastTool(provider, 5), /"rag": "acg-2021-textbook"/);
  assert.ok(embeddings.calls >= 3);
  assert.ok(await workspace.stat('u1', '.rag/acg-2021-textbook/vectors.f32'));
  // .rag stays out of normal listings.
  assert.ok((await workspace.list('u1', '')).some((e) => e.path === '.rag'));
});

test('rag: re-adding a file replaces its chunks; mismatched models are refused', async () => {
  const { workspace, sink, engine } = setup();
  const agent = engine.forUser(profile);
  await workspace.write('u1', 'a.txt', 'First version about photosynthesis in plants and light energy.');
  const provider = new ScriptedProvider([
    () => [...toolCall('rag_create', { name: 'bio', description: 'b' }, 'a'), ...toolCall('rag_add', { rag: 'bio', paths: ['a.txt'] }, 'b')],
    () => text('ok'),
  ]);
  await agent.run({ runId: 'r1', model: model(provider), history: [user('x')], sink });
  await workspace.write('u1', 'a.txt', 'Second version about cellular respiration and mitochondria energy.');
  const again = new ScriptedProvider([() => toolCall('rag_add', { rag: 'bio', paths: ['a.txt'] }, 'c'), () => text('ok')]);
  await agent.run({ runId: 'r2', model: model(again), history: [user('x')], sink });
  const chunks = (await workspace.read('u1', '.rag/bio/chunks.jsonl')).toString().trim().split('\n');
  assert.equal(chunks.length, 1);
  assert.match(chunks[0]!, /Second version/);

  const manifest = JSON.parse((await workspace.read('u1', '.rag/bio/manifest.json')).toString());
  await workspace.write('u1', '.rag/bio/manifest.json', JSON.stringify({ ...manifest, model: 'other-model' }));
  const mismatch = new ScriptedProvider([() => toolCall('rag_search', { rag: 'bio', query: 'energy' }, 'd'), () => text('ok')]);
  await agent.run({ runId: 'r3', model: model(mismatch), history: [user('x')], sink });
  assert.match(lastTool(mismatch), /built with .*other-model/);
});

test('rag: shared collections are searchable and read-only', async () => {
  // A shared RAG built by someone else, in the same file format.
  const builder = setup();
  await builder.workspace.write('u1', 'syllabus.txt', 'The final exam covers chapters one through eight of the textbook.');
  const p = new ScriptedProvider([() => [...toolCall('rag_create', { name: 'course', description: 'Course syllabus' }, 'a'), ...toolCall('rag_add', { rag: 'course', paths: ['syllabus.txt'] }, 'b')], () => text('ok')]);
  await builder.agent.run({ runId: 'b', model: model(p), history: [user('x')], sink: builder.sink });
  const shared: SharedRagSource = {
    async list() {
      return [{ id: 'acg2021/syllabus', name: 'ACG 2021 syllabus', description: 'From the instructor', model: 'test-words', chunks: 1 }];
    },
    async readFile(_userId, _id, file) {
      return builder.workspace.read('u1', `.rag/course/${file}`).catch(() => null);
    },
  };

  const { agent, sink } = setup({ shared });
  const provider = new ScriptedProvider([
    () => [...toolCall('rag_list', {}, 'a'), ...toolCall('rag_search', { rag: 'shared:acg2021/syllabus', query: 'final exam chapters' }, 'b'), ...toolCall('rag_delete', { rag: 'shared:acg2021/syllabus' }, 'c')],
    () => text('ok'),
  ]);
  await agent.run({ runId: 'r1', model: model(provider), history: [user('x')], sink });
  const [list, found, deleted] = stepResults(provider, 1);
  assert.match(list!, /"rag": "shared:acg2021\/syllabus"[\s\S]*"read_only": true/);
  assert.match(found!, /final exam covers chapters/);
  assert.match(deleted!, /read-only/);
});

test('without a workspace or embeddings the packs are not offered', async () => {
  const engine = createEngine({
    stores: { runs: new InMemoryRunStore(), memory: new InMemoryMemoryStore(), skills: new InMemorySkillStore(), schedules: new InMemoryScheduleStore() },
    basePrompt: 'x',
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
  });
  const names = engine.forUser(profile).tools().map((t) => t.name);
  assert.ok(!names.some((n) => n.startsWith('files_') || n.startsWith('rag_')));
  const filesOnly = createEngine({
    stores: { runs: new InMemoryRunStore(), memory: new InMemoryMemoryStore(), skills: new InMemorySkillStore(), schedules: new InMemoryScheduleStore() },
    basePrompt: 'x',
    workspace: new InMemoryWorkspace(),
  });
  const names2 = filesOnly.forUser(profile).tools().map((t) => t.name);
  assert.ok(names2.includes('files_read') && !names2.includes('rag_search'));
});

test('rag: adding the same unchanged files again skips them (resume after a stop)', async () => {
  const { workspace, sink, engine } = setup();
  const agent = engine.forUser(profile);
  await workspace.write('u1', 'notes/a.txt', 'Mitosis has four phases: prophase, metaphase, anaphase and telophase.');
  await workspace.write('u1', 'notes/b.txt', 'Meiosis produces four haploid cells from one diploid cell.');
  const first = new ScriptedProvider([
    () => [...toolCall('rag_create', { name: 'bio', description: 'b' }, 'a'), ...toolCall('rag_add', { rag: 'bio', paths: ['notes'] }, 'b')],
    () => text('ok'),
  ]);
  await agent.run({ runId: 'r1', model: model(first), history: [user('x')], sink });
  await workspace.write('u1', 'notes/c.txt', 'Cytokinesis divides the cytoplasm after mitosis.');
  const again = new ScriptedProvider([() => toolCall('rag_add', { rag: 'bio', paths: ['notes'] }, 'c'), () => text('ok')]);
  await agent.run({ runId: 'r2', model: model(again), history: [user('x')], sink });
  const result = lastTool(again);
  assert.match(result, /"unchanged_already_indexed": 2/);
  assert.match(result, /notes\/c\.txt/);
  assert.match(result, /"total_chunks": 3/);
  const manifest = JSON.parse((await workspace.read('u1', '.rag/bio/manifest.json')).toString());
  assert.equal(manifest.sources.length, 3);
  assert.ok(manifest.sources.every((s: { size?: number }) => typeof s.size === 'number'));
});
