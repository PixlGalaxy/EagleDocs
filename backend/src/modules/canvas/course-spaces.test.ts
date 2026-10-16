import assert from 'node:assert/strict';
import { test } from 'node:test';
import { courseFolder, courseSpacesNote, folderName, termFor } from './course-spaces.js';

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

test('a course folder sits under its term', () => {
  assert.equal(courseFolder({ name: 'PHY 2048 Physics I (Fall 2026)', course_code: 'PHY2048', term: 'Fall 2026' }, 'Spring 2027'), 'Fall 2026/PHY 2048 Physics I');
  assert.equal(courseFolder({ name: '', course_code: 'MAC2311', term: null }, 'Fall 2026'), 'Fall 2026/MAC2311');
});

test('the note tells the agent each course folder and what goes in it', () => {
  const note = courseSpacesNote([{ id: 1, name: 'PHY 2048 Physics I', folder: 'Fall 2026/PHY 2048 Physics I' }]);
  assert.match(note, /PHY 2048 Physics I: "Fall 2026\/PHY 2048 Physics I\/"/);
  for (const sub of ['Canvas/', 'Work/', 'Assignments/', 'Notes/', 'TEMP/']) assert.ok(note.includes(sub), sub);
  assert.equal(courseSpacesNote([]), '');
});
