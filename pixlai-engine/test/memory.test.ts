import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyOperations, DEFAULT_LIMITS, ENTRY_SEPARATOR } from '../src/index.js';
import { model, ScriptedProvider, setup, text, toolCall } from './helpers.js';

const user = (content: string) => ({ role: 'user' as const, content });

test('entries are added, patched and removed in one batch, checked against the limit at the end', () => {
  const start = ['Studies Accounting', 'Works mornings at the library'].join(ENTRY_SEPARATOR);
  const next = applyOperations('user', start, [
    { action: 'remove', old_text: 'library' },
    { action: 'patch', old_text: 'Accounting', content: 'Accounting (junior)' },
    { action: 'add', content: 'Prefers answers in Spanish' },
    { action: 'add', content: 'prefers answers in spanish' },
  ], 1500);
  assert.equal(next, ['Studies Accounting (junior)', 'Prefers answers in Spanish'].join(ENTRY_SEPARATOR), 'duplicates are skipped');

  assert.throws(() => applyOperations('user', start, [{ action: 'add', content: 'x'.repeat(200) }], 100), /would have \d+ of 100/);
  // Freeing room in the same call makes the add fit.
  assert.doesNotThrow(() => applyOperations('user', start, [{ action: 'remove', old_text: 'Studies' }, { action: 'remove', old_text: 'library' }, { action: 'add', content: 'x'.repeat(90) }], 100));
  assert.throws(() => applyOperations('user', 'a cat§\na hat'.replace('§\n', ENTRY_SEPARATOR.slice(1)), [{ action: 'remove', old_text: 'at' }], 100), /in 2 entries/);
  assert.throws(() => applyOperations('soul', 'Calm tutor', [{ action: 'add', content: 'x' }], 100), /replace/);
  assert.equal(applyOperations('soul', 'Calm tutor', [{ action: 'replace', content: 'Energetic coach' }], 100), 'Energetic coach');
});

test('SOUL.md, USER.md and MEMORY.md reach every conversation; the agent edits them', async () => {
  const { agent, stores, sink } = setup();
  await stores.memory.write('u1', 'soul', 'You are Hawk, a calm and direct study partner.');
  const saving = new ScriptedProvider([
    () => toolCall('memory_update', { target: 'user', operations: [{ action: 'add', content: 'Ana works Tuesday nights' }] }),
    () => toolCall('memory_update', { target: 'notes', action: 'add', content: 'Canvas briefing works best with days=14' }),
    () => text('noted'),
  ]);
  await agent.run({ runId: 'r1', model: model(saving), history: [user('I work Tuesday nights')], sink });
  const next = new ScriptedProvider([() => text('hi')]);
  await agent.run({ runId: 'r2', model: model(next), history: [user('hola')], sink });
  const system = next.requests[0]!.messages[0]!.content;
  assert.match(system, /## Your personality \(SOUL\.md\)\nYou are Hawk/);
  assert.match(system, /## What you know about the user \(USER\.md\)\n- Ana works Tuesday nights/);
  assert.match(system, /## Your notes \(MEMORY\.md\)\n- Canvas briefing works best/);
  assert.match(system, new RegExp(`USER\.md 24/${DEFAULT_LIMITS.userChars}`));

  const full = new ScriptedProvider([() => toolCall('memory_update', { target: 'notes', action: 'add', content: 'y'.repeat(DEFAULT_LIMITS.notesChars) }), () => text('ok')]);
  const result = await agent.run({ runId: 'r3', model: model(full), history: [user('x')], sink });
  assert.match(String(result.messages.find((m) => m.role === 'tool')?.content), /remove or shorten entries/);
});
