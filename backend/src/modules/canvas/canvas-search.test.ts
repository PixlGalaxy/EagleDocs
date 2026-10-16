import assert from 'node:assert/strict';
import { test } from 'node:test';
import { linksIn, rank, score, words, type CanvasThing } from './canvas-search.js';

const thing = (title: string, module = '', kind: CanvasThing['kind'] = 'file'): CanvasThing => ({ kind, title, module, course_id: 1, course: 'ACG 2021' });

test('words: accents, case, and letters glued to numbers', () => {
  assert.deepEqual(words('Capítulo 7'), ['capitulo', '7']);
  assert.deepEqual(words('H7'), ['h7', 'h', '7']);
  assert.deepEqual(words('Chapter7_Packet.pdf'), ['chapter7', 'chapter', '7', 'packet', 'pdf']);
});

test('score: a half-remembered name finds the file', () => {
  assert.ok(score('homework packet', 'Chapter 7 Homework Packet.pdf') > score('homework packet', 'Chapter 7 Slides.pdf'));
  assert.ok(score('ch 7 homework', 'Chapter 7 Homework Packet.pdf') > 0);
  assert.ok(score('hw7', 'Chapter 7 Homework Packet.pdf') > 0, 'hw + 7');
  assert.equal(score('chapter 8', 'Chapter 7 Homework Packet.pdf') < score('chapter 7', 'Chapter 7 Homework Packet.pdf'), true);
  assert.equal(score('biology', 'Chapter 7 Homework Packet.pdf'), 0);
});

test('score: numbers must match exactly', () => {
  assert.ok(score('7', 'Chapter 17 Notes') === 0);
  assert.ok(score('7', 'Chapter 7 Notes') > 0);
});

test('score: the module counts, with less weight', () => {
  const inModule = score('files semester', 'Homework Packet', 'Files for the Semester');
  assert.ok(inModule > 0);
  assert.ok(inModule < score('files semester', 'Files for the Semester'));
});

test('rank: best first, no matches dropped', () => {
  const ranked = rank('homework packet ch 7', [
    thing('Chapter 6 Homework Packet.pdf'),
    thing('Chapter 7 Homework Packet.pdf', 'Files for the Semester'),
    thing('Syllabus.pdf'),
    thing('H7 Chapter 7 Homework', '', 'quiz'),
  ]);
  assert.equal(ranked[0]!.title, 'Chapter 7 Homework Packet.pdf');
  assert.ok(!ranked.some((r) => r.title === 'Syllabus.pdf'));
});

test('linksIn: files, pages and assignments from a description, with their link text', () => {
  const html =
    '<a href="https://school.instructure.com/courses/5/files/123/download">hmwk07.docx</a> <a href="/courses/5/files/123">again</a> ' +
    '<a class="instructure_file_link" title="Ch 8 packet.pdf" href="/courses/5/files/124?wrap=1"><span></span></a> ' +
    '<a href="/courses/5/pages/week-7-notes">Week 7 <b>notes</b></a> <a href="/courses/5/assignments/77">H6</a> ' +
    '<img src="/courses/5/files/999/preview">';
  assert.deepEqual(linksIn(html), {
    files: [
      { file_id: 123, text: 'hmwk07.docx' },
      { file_id: 124, text: 'Ch 8 packet.pdf' },
      { file_id: 999, text: '' },
    ],
    pages: [{ page_url: 'week-7-notes', text: 'Week 7 notes' }],
    assignment_ids: [77],
  });
  assert.deepEqual(linksIn(null), { files: [], pages: [], assignment_ids: [] });
});

test('score: short names and zero-padded numbers in file names', () => {
  assert.ok(score('homework 7', 'hmwk07.docx') > 0);
  assert.ok(score('chapter 7 homework packet', 'hmwk07.docx') > 0);
  assert.ok(score('homework 7', 'hmwk07.docx') > score('homework 7', 'hmwk08.docx'));
  const ranked = rank('homework packet 7', [thing('hmwk06.docx', 'Files for the Semester'), thing('hmwk07.docx', 'Files for the Semester'), thing('Syllabus.pdf')]);
  assert.equal(ranked[0]!.title, 'hmwk07.docx');
});
