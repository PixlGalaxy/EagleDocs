import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toTsQuery } from './chat-search.js';

test('every word becomes a prefix, joined as asked', () => {
  assert.equal(toTsQuery('Ensayo historia', '&'), 'ensayo:* & historia:*');
  assert.equal(toTsQuery('ensayo historia', '|'), 'ensayo:* | historia:*');
});

test('accents and ñ stay part of the word; punctuation splits', () => {
  assert.equal(toTsQuery('cálculo: año-2025!', '&'), 'cálculo:* & año:* & 2025:*');
});

test('tsquery syntax in the input cannot get through', () => {
  assert.equal(toTsQuery("a & b | !c:* (d) 'e'", '&'), null);
  assert.equal(toTsQuery("ab & cd | !ef:* (gh)", '&'), 'ab:* & cd:* & ef:* & gh:*');
});

test('nothing searchable gives null', () => {
  assert.equal(toTsQuery('  ¿? ', '&'), null);
});

test('long queries keep their first twelve words', () => {
  const words = Array.from({ length: 20 }, (_, i) => `w${i}x`).join(' ');
  assert.equal(toTsQuery(words, '|')!.split(' | ').length, 12);
});
