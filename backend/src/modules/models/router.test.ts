import assert from 'node:assert/strict';
import { test } from 'node:test';
import { routeTier } from './router.js';

const tier = (text: string, extra: Partial<Parameters<typeof routeTier>[0]> = {}) => routeTier({ text, historyChars: 0, ...extra }).tier;

test('small talk goes to the fast model', () => {
  assert.equal(tier('hola'), 'fast');
  assert.equal(tier('Thanks!'), 'fast');
  assert.equal(tier('qué hora es'), 'fast');
});

test('programming goes to the code model', () => {
  assert.equal(tier('arregla este bug en python'), 'code');
  assert.equal(tier('Why does my SQL query return duplicates?'), 'code');
  assert.equal(tier('```js\nconsole.log(1)\n```'), 'code');
});

test('reasoning and school data go to the smart model', () => {
  assert.equal(tier('Compara mis opciones de horario para el próximo semestre'), 'smart');
  assert.equal(tier('What assignments are due this week in Canvas?'), 'smart');
  assert.equal(tier('Explica la diferencia entre mitosis y meiosis'), 'smart');
});

test('images always go to vision', () => {
  assert.equal(tier('hola', { hasImage: true }), 'vision');
});

test('asking to think harder escalates', () => {
  assert.equal(tier('ok'), 'fast');
  assert.equal(tier('ok', { escalate: true }), 'smart');
  assert.equal(tier('piénsalo mejor, está mal'), 'smart');
});

test('long messages and documents lean smart', () => {
  assert.equal(tier('a '.repeat(900)), 'smart');
  assert.equal(tier('revisa esto', { hasDocument: true, historyChars: 20_000 }), 'smart');
});

test('routing is deterministic', () => {
  const input = { text: 'Plan my study week for calculus', historyChars: 500 };
  assert.deepEqual(routeTier(input), routeTier(input));
});
