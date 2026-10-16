import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ItemView } from '../canvas/canvas.service.js';
import { buildDigest, dueDate, localClock, nextDate } from './daily-summary.js';

const NY = 'America/New_York';
const at = (iso: string) => new Date(iso);
const due = (pref: { timezone?: string | null; hour?: number; lastSentOn?: string | null }, now: string) =>
  dueDate({ timezone: NY, hour: 7, lastSentOn: null, ...pref }, at(now));

test('local date and hour follow the timezone', () => {
  // 03:30 UTC is still the previous evening in New York and already morning in Madrid.
  assert.deepEqual(localClock(NY, at('2026-10-16T03:30:00Z')), { date: '2026-10-15', hour: 23 });
  assert.deepEqual(localClock('Europe/Madrid', at('2026-10-16T03:30:00Z')), { date: '2026-10-16', hour: 5 });
  assert.deepEqual(localClock('Asia/Kolkata', at('2026-10-16T20:00:00Z')), { date: '2026-10-17', hour: 1 });
  // Midnight is hour 0, not 24.
  assert.equal(localClock(NY, at('2026-10-16T04:00:00Z')).hour, 0);
});

test('no timezone or a broken one falls back to New York', () => {
  assert.deepEqual(localClock(null, at('2026-10-16T11:00:00Z')), { date: '2026-10-16', hour: 7 });
  assert.deepEqual(localClock('Not/AZone', at('2026-10-16T11:00:00Z')), { date: '2026-10-16', hour: 7 });
});

test('the next date crosses months, years and DST days', () => {
  assert.equal(nextDate('2026-10-31'), '2026-11-01');
  assert.equal(nextDate('2026-12-31'), '2027-01-01');
  assert.equal(nextDate('2028-02-28'), '2028-02-29');
  assert.equal(nextDate('2026-03-08'), '2026-03-09');
});

test('due once the local hour comes, and only within a few hours of it', () => {
  // 7:00 in New York (EDT, UTC-4) is 11:00 UTC.
  assert.equal(due({}, '2026-10-16T10:59:00Z'), null);
  assert.equal(due({}, '2026-10-16T11:00:00Z'), '2026-10-16');
  assert.equal(due({}, '2026-10-16T13:59:00Z'), '2026-10-16');
  // Back from an outage in the afternoon: no morning summary at 15:00.
  assert.equal(due({}, '2026-10-16T19:00:00Z'), null);
  // A late hour never wraps into the next morning.
  assert.equal(due({ hour: 23 }, '2026-10-17T03:30:00Z'), '2026-10-16');
  assert.equal(due({ hour: 23 }, '2026-10-17T04:30:00Z'), null);
});

test('each local day is sent once', () => {
  assert.equal(due({ lastSentOn: '2026-10-16' }, '2026-10-16T11:05:00Z'), null);
  // Yesterday's send does not block today.
  assert.equal(due({ lastSentOn: '2026-10-15' }, '2026-10-16T11:05:00Z'), '2026-10-16');
  // The UTC date is already the 17th, but in New York it is still the 16th: already sent.
  assert.equal(due({ hour: 22, lastSentOn: '2026-10-16' }, '2026-10-17T02:30:00Z'), null);
});

test('the same instant is due in one timezone and not in another', () => {
  assert.equal(due({ timezone: 'Europe/Madrid' }, '2026-10-16T05:00:00Z'), '2026-10-16');
  assert.equal(due({ timezone: NY }, '2026-10-16T05:00:00Z'), null);
});

test('DST: the summary keeps its local hour, and a skipped hour is caught by the next', () => {
  // Winter (EST, UTC-5): 7:00 is 12:00 UTC.
  assert.equal(due({}, '2026-11-02T11:30:00Z'), null);
  assert.equal(due({}, '2026-11-02T12:00:00Z'), '2026-11-02');
  // Spring forward, 2026-03-08: 2:00 does not exist, 3:00 EDT (07:00 UTC) sends it.
  assert.equal(due({ hour: 2 }, '2026-03-08T06:59:00Z'), null);
  assert.equal(due({ hour: 2 }, '2026-03-08T07:00:00Z'), '2026-03-08');
  // Fall back, 2026-11-01: 1:00 happens twice; the second one is the same local date, so nothing is sent again.
  assert.equal(due({ hour: 1 }, '2026-11-01T05:10:00Z'), '2026-11-01');
  assert.equal(due({ hour: 1, lastSentOn: '2026-11-01' }, '2026-11-01T06:10:00Z'), null);
});

const t = ((key: string) =>
  ({
    'pushMsg.dailyTitle': 'Due today: {today} · Tomorrow: {tomorrow}',
    'pushMsg.dailyToday': 'Today',
    'pushMsg.dailyTomorrow': 'Tomorrow',
    'pushMsg.dailyMore': '+{count} more',
  })[key] ?? key) as never;

const item = (title: string, due_at: string | null, extra: Partial<ItemView> = {}): ItemView => ({
  id: title,
  course_id: 1,
  course_name: 'MAC 2311',
  kind: 'assignment',
  title,
  due_at,
  points: 10,
  submitted: false,
  missing: false,
  estimate_hours: 1,
  priority: 50,
  html_url: '',
  ...extra,
});

test('the digest lists what is due today and tomorrow in local time, soonest first', () => {
  const now = at('2026-10-16T11:00:00Z'); // 7:00 in New York
  const message = buildDigest(
    [
      item('Lab report', '2026-10-18T03:59:00Z'), // 23:59 on the 17th in New York: tomorrow
      item('Quiz 3', '2026-10-16T17:00:00Z'), // 13:00 today
      item('Essay', '2026-10-18T13:00:00Z'), // the day after tomorrow
      item('Done already', '2026-10-16T20:00:00Z', { submitted: true }),
      item('Overdue', '2026-10-15T20:00:00Z', { missing: true }),
      item('Undated', null),
    ],
    NY,
    'en',
    t,
    now,
  );
  assert.ok(message);
  assert.equal(message.kind, 'daily_summary');
  assert.equal(message.title, 'Due today: 1 · Tomorrow: 1');
  assert.equal(message.url, '/courses');
  assert.equal(message.tag, 'daily-2026-10-16');
  const lines = message.body.split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0]!, /^Today 1:00\sPM: Quiz 3 \(MAC 2311\)$/);
  assert.match(lines[1]!, /^Tomorrow 11:59\sPM: Lab report \(MAC 2311\)$/);
});

test('nothing due means no push', () => {
  const now = at('2026-10-16T11:00:00Z');
  assert.equal(buildDigest([], NY, 'en', t, now), null);
  assert.equal(buildDigest([item('Next week', '2026-10-23T12:00:00Z'), item('Sent', '2026-10-16T20:00:00Z', { submitted: true })], NY, 'en', t, now), null);
});

test('a long day is cut to a few lines plus a count', () => {
  const now = at('2026-10-16T11:00:00Z');
  const items = Array.from({ length: 8 }, (_, i) => item(`Task ${i + 1}`, `2026-10-16T${String(13 + i).padStart(2, '0')}:00:00Z`));
  const message = buildDigest(items, NY, 'en', t, now)!;
  const lines = message.body.split('\n');
  assert.equal(lines.length, 6);
  assert.equal(lines[5], '+3 more');
  assert.equal(message.title, 'Due today: 8 · Tomorrow: 0');
});

test('times are written in the student language', () => {
  const now = at('2026-10-16T11:00:00Z');
  const message = buildDigest([item('Quiz', '2026-10-16T17:00:00Z')], NY, 'es', t, now)!;
  assert.match(message.body, /13:00/);
});
