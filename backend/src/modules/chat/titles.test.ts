import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanTitle } from './titles.js';

test('a model reply becomes a clean, short chat title', () => {
  assert.equal(cleanTitle('Accounting quiz prep'), 'Accounting quiz prep');
  assert.equal(cleanTitle('Title: "Resumen del capítulo 4."'), 'Resumen del capítulo 4');
  assert.equal(cleanTitle('<think>the user wants a quiz</think>\n\n**Quiz de historia**'), 'Quiz de historia');
  assert.equal(cleanTitle('# Study plan\nsecond line ignored'), 'Study plan');
  assert.equal(cleanTitle('“Resume review”'), 'Resume review');
  assert.equal(cleanTitle('<think>never finished'), null, 'reasoning with no answer');
  assert.equal(cleanTitle('   '), null);
  assert.equal(cleanTitle('x'.repeat(120)), null, 'a paragraph is not a title');
  assert.equal(cleanTitle(`${'word '.repeat(14)}end`)!.length <= 60, true);
});
