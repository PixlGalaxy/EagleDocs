import assert from 'node:assert/strict';
import { test } from 'node:test';
import { estimateHours, priorityScore, stripHtml } from './priority.js';

const now = new Date('2026-10-13T12:00:00Z');
const inHours = (h: number) => new Date(now.getTime() + h * 3_600_000).toISOString();

test('estimates follow the canvas-lms skill table', () => {
  assert.equal(estimateHours({ name: 'Quiz 3', submitted: false }).hours, 2);
  assert.equal(estimateHours({ name: 'Final project', points_possible: 100, submitted: false }).hours, 7);
  assert.equal(estimateHours({ name: 'Week 5 discussion', submitted: false }).hours, 1);
  assert.equal(estimateHours({ name: 'Lab 2', submitted: false }).hours, 3);
  assert.equal(estimateHours({ name: 'Essay', submission_types: ['online_upload'], submitted: false }).hours, 2);
  assert.equal(estimateHours({ name: 'Reading', description: `<p>${'x'.repeat(1600)}</p>`, submitted: false }).hours, 2.5);
});

test('closer, heavier and unsubmitted work ranks higher', () => {
  const tomorrow = priorityScore({ name: 'Homework', points_possible: 20, due_at: inHours(20), submitted: false }, now);
  const nextWeek = priorityScore({ name: 'Homework', points_possible: 20, due_at: inHours(150), submitted: false }, now);
  const later = priorityScore({ name: 'Homework', points_possible: 20, due_at: inHours(400), submitted: false }, now);
  assert.ok(tomorrow.score > nextWeek.score && nextWeek.score > later.score);
  assert.equal(tomorrow.label, 'due within 24h');

  const submitted = priorityScore({ name: 'Homework', points_possible: 20, due_at: inHours(20), submitted: true }, now);
  assert.ok(submitted.score < tomorrow.score);
  const heavy = priorityScore({ name: 'Homework', points_possible: 100, due_at: inHours(20), submitted: false }, now);
  assert.ok(heavy.score > tomorrow.score);
  assert.equal(priorityScore({ name: 'x', due_at: inHours(-2), submitted: false }, now).label, 'overdue');
});

test('the formula matches the skill exactly', () => {
  // urgency 95, weight 20, effort 1.5h*12 = 18, status 35
  const { score } = priorityScore({ name: 'Homework', points_possible: 20, due_at: inHours(10), submitted: false }, now);
  assert.equal(score, Math.round((0.45 * 95 + 0.25 * 20 + 0.2 * 18 + 0.1 * 35) * 10) / 10);
});

test('html is stripped to readable text', () => {
  assert.equal(stripHtml('<p>Read <b>chapter 3</b> &amp; answer</p><script>alert(1)</script>'), 'Read chapter 3 & answer');
  assert.equal(stripHtml('<p>Quiz is now <strong>Thursday</strong>. See <a href="x">this</a>.</p>'), 'Quiz is now Thursday. See this.');
});
