import assert from 'node:assert/strict';
import { test } from 'node:test';
import { folderName, termFor } from './course-folders.js';

test('the term comes from the date when Canvas has none', () => {
  assert.equal(termFor(new Date('2026-10-14T12:00:00Z')), 'Fall 2026');
  assert.equal(termFor(new Date('2027-02-01T12:00:00Z')), 'Spring 2027');
  assert.equal(termFor(new Date('2027-06-20T12:00:00Z')), 'Summer 2027');
});

test('course folder names are readable and safe on every file system', () => {
  assert.equal(folderName('ACG 2071 Managerial Accounting (Fall 2026)', 'Fall 2026'), 'ACG 2071 Managerial Accounting');
  assert.equal(folderName('ARH2000: Art / Culture?', undefined), 'ARH2000 Art Culture');
  assert.equal(folderName('...', undefined), 'Course');
  assert.ok(folderName('x'.repeat(200)).length <= 70);
});
