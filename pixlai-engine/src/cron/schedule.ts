/**
 * Schedules the agent can create, all evaluated in the user's timezone:
 * - cron, 5 fields: "0 8 * * 1" (Mondays at 8:00). Names (MON, JAN), ranges, lists and steps work;
 *   runs at least 15 minutes apart.
 * - interval: "every 30m", "every 2h", "every 1d" (minimum 15 minutes).
 * - one-off: an ISO date/time, "2026-11-02T09:00" (local to the timezone unless it carries an offset).
 */

export type ParsedSchedule =
  | { kind: 'cron'; minute: Set<number>; hour: Set<number>; dom: Set<number>; month: Set<number>; dow: Set<number>; domAny: boolean; dowAny: boolean }
  | { kind: 'interval'; ms: number }
  | { kind: 'once'; local: string };

export const MIN_INTERVAL_MS = 15 * 60 * 1000;

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function parseField(field: string, min: number, max: number, names?: string[]): Set<number> {
  const values = new Set<number>();
  const value = (token: string): number => {
    const upper = token.toUpperCase();
    const named = names?.indexOf(upper) ?? -1;
    if (named >= 0) return named + (min === 1 ? 1 : 0);
    if (!/^\d+$/.test(token)) throw new Error(`"${token}" is not a number`);
    return Number(token);
  };
  for (const part of field.split(',')) {
    const [range, stepText] = part.split('/');
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) throw new Error(`Bad step in "${part}"`);
    let from: number;
    let to: number;
    if (range === '*') {
      from = min;
      to = max;
    } else if (range!.includes('-')) {
      const [a, b] = range!.split('-');
      from = value(a!);
      to = value(b!);
    } else {
      from = value(range!);
      to = stepText === undefined ? from : max;
    }
    if (from < min || to > max || from > to) throw new Error(`"${part}" is out of range ${min}-${max}`);
    for (let n = from; n <= to; n += step) values.add(n);
  }
  return values;
}

export function parseSchedule(input: string): ParsedSchedule {
  const text = input.trim();

  const interval = /^every\s+(\d+)\s*(m|min|mins|minutes?|h|hrs?|hours?|d|days?)$/i.exec(text);
  if (interval) {
    const n = Number(interval[1]);
    const unit = interval[2]!.toLowerCase()[0];
    const ms = n * (unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000);
    if (ms < MIN_INTERVAL_MS) throw new Error('The shortest interval is 15 minutes');
    return { kind: 'interval', ms };
  }

  if (/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?(Z|[+-]\d{2}:?\d{2})?$/.test(text)) {
    return { kind: 'once', local: text.replace(' ', 'T') };
  }

  const fields = text.split(/\s+/);
  if (fields.length !== 5) {
    throw new Error('Use a 5-field cron expression ("0 8 * * 1"), an interval ("every 2h") or a date ("2026-11-02T09:00")');
  }
  const [minute, hour, dom, month, dow] = fields as [string, string, string, string, string];
  const dowSet = parseField(dow, 0, 7, DAYS);
  if (dowSet.has(7)) {
    dowSet.delete(7);
    dowSet.add(0);
  }
  const minutes = parseField(minute, 0, 59);
  const hours = parseField(hour, 0, 23);
  if (shortestDailyGap(minutes, hours) < MIN_INTERVAL_MS / 60_000) throw new Error('Runs must be at least 15 minutes apart');
  return {
    kind: 'cron',
    minute: minutes,
    hour: hours,
    dom: parseField(dom, 1, 31),
    month: parseField(month, 1, 12, MONTHS),
    dow: dowSet,
    domAny: dom === '*',
    dowAny: dow === '*',
  };
}

/** Minutes between the closest two runs of a day's minute/hour pattern (the day filters only spread them out). */
function shortestDailyGap(minutes: Set<number>, hours: Set<number>): number {
  const times: number[] = [];
  for (const h of [...hours].sort((a, b) => a - b)) for (const m of [...minutes].sort((a, b) => a - b)) times.push(h * 60 + m);
  if (times.length < 2) return Infinity;
  let gap = 1440 - times.at(-1)! + times[0]!;
  for (let i = 1; i < times.length; i++) gap = Math.min(gap, times[i]! - times[i - 1]!);
  return gap;
}

export function isValidTimezone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  dow: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function localParts(date: Date, timeZone: string): LocalParts {
  let fmt = formatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      weekday: 'short',
    });
    formatters.set(timeZone, fmt);
  }
  const parts: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) parts[part.type] = part.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    dow: DAYS.indexOf(parts.weekday!.toUpperCase().slice(0, 3)),
  };
}

/** Milliseconds the zone is ahead of UTC at `date`. */
function zoneOffsetMs(date: Date, timeZone: string): number {
  const p = localParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return asUtc - Math.floor(date.getTime() / 60_000) * 60_000;
}

/** "2026-11-02T09:00" read as wall-clock time in `timeZone`. */
function localToDate(local: string, timeZone: string): Date {
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(local)) return new Date(local);
  const naive = new Date(`${local.length === 10 ? `${local}T00:00` : local}Z`);
  // Two passes settle DST edges.
  let guess = new Date(naive.getTime() - zoneOffsetMs(naive, timeZone));
  guess = new Date(naive.getTime() - zoneOffsetMs(guess, timeZone));
  return guess;
}

const MINUTE = 60_000;

/**
 * The first run strictly after `after`, or null when there is none (a past
 * one-off, or a cron that never matches within a year).
 */
export function nextRun(schedule: ParsedSchedule, timeZone: string, after: Date, lastRun?: Date | null): Date | null {
  if (schedule.kind === 'interval') {
    const base = lastRun ?? after;
    const next = new Date(base.getTime() + schedule.ms);
    return next > after ? next : new Date(after.getTime() + schedule.ms);
  }
  if (schedule.kind === 'once') {
    const at = localToDate(schedule.local, timeZone);
    return at > after ? at : null;
  }

  // Walk forward, skipping whole days and hours that cannot match.
  let t = Math.floor(after.getTime() / MINUTE) * MINUTE + MINUTE;
  const limit = after.getTime() + 366 * 24 * 60 * MINUTE;
  while (t <= limit) {
    const p = localParts(new Date(t), timeZone);
    const domOk = schedule.dom.has(p.day);
    const dowOk = schedule.dow.has(p.dow);
    // Classic cron: when both day fields are restricted, either may match.
    const dayOk = schedule.domAny && schedule.dowAny ? true : schedule.domAny ? dowOk : schedule.dowAny ? domOk : domOk || dowOk;
    if (!schedule.month.has(p.month) || !dayOk) {
      t += ((23 - p.hour) * 60 + (60 - p.minute)) * MINUTE;
      continue;
    }
    if (!schedule.hour.has(p.hour)) {
      t += (60 - p.minute) * MINUTE;
      continue;
    }
    if (!schedule.minute.has(p.minute)) {
      t += MINUTE;
      continue;
    }
    return new Date(t);
  }
  return null;
}

/** Validates and computes the first run, with messages the model can act on. */
export function planSchedule(schedule: string, timeZone: string, now: Date): { nextRunAt: Date } {
  if (!isValidTimezone(timeZone)) throw new Error(`Unknown timezone "${timeZone}"`);
  const parsed = parseSchedule(schedule);
  const next = nextRun(parsed, timeZone, now);
  if (!next) throw new Error('That schedule never runs in the future');
  return { nextRunAt: next };
}
