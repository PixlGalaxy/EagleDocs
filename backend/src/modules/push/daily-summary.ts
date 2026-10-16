import type { Db } from '../../db/pool.js';
import { many, maybe } from '../../db/pool.js';
import { AppError } from '../../errors.js';
import { format, type Translate } from '../../i18n/index.js';
import { logger } from '../../logger.js';
import type { CanvasService, ItemView } from '../canvas/canvas.service.js';
import type { PushMessage, PushService } from './push.service.js';

/** Same fallback the agent uses when the student never picked a timezone. */
const DEFAULT_TIMEZONE = 'America/New_York';
/** After a restart or an outage the summary may still go out a little late, but not in the evening. */
const MAX_LATE_HOURS = 3;
/** Lines in the notification body; the rest is "+N more". */
const MAX_LINES = 5;

export interface DailySummarySetting {
  enabled: boolean;
  hour: number;
}

/** The timezone to use: the student's, or the default when they never picked one or it is not a valid one. */
function zoneOf(timezone: string | null): string {
  if (!timezone) return DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return timezone;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

/** The calendar date ("2026-10-16") and hour in a timezone. */
export function localClock(timezone: string | null, at: Date): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zoneOf(timezone), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) % 24 };
}

/** The day after a "YYYY-MM-DD" date (plain calendar math, so DST never shifts it). */
export function nextDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Whether the summary should go out now: the local hour reached the student's hour (within a few hours, so a
 * restart at night does not send the morning summary) and nothing was sent on this local date yet. Returns the
 * local date to record, or null. On a spring-forward day a skipped hour is caught by the next one.
 */
export function dueDate(pref: { timezone: string | null; hour: number; lastSentOn: string | null }, now: Date): string | null {
  const { date, hour } = localClock(pref.timezone, now);
  if (pref.lastSentOn === date) return null;
  return hour >= pref.hour && hour < pref.hour + MAX_LATE_HOURS ? date : null;
}

/** The push for the work due today and tomorrow (local dates), or null when there is none. Submitted work is left out. */
export function buildDigest(items: ItemView[], timezone: string | null, language: string, t: Translate, now: Date): PushMessage | null {
  const today = localClock(timezone, now).date;
  const tomorrow = nextDate(today);
  const time = new Intl.DateTimeFormat(language === 'es' ? 'es' : 'en-US', { timeZone: zoneOf(timezone), hour: 'numeric', minute: '2-digit' });
  const due = items
    .filter((i) => i.due_at && !i.submitted)
    .map((i) => ({ item: i, day: localClock(timezone, new Date(i.due_at!)).date }))
    .filter((d) => d.day === today || d.day === tomorrow)
    .sort((a, b) => a.item.due_at!.localeCompare(b.item.due_at!));
  if (due.length === 0) return null;
  const count = (day: string) => due.filter((d) => d.day === day).length;
  const lines = due.slice(0, MAX_LINES).map(({ item, day }) => {
    const label = t(day === today ? 'pushMsg.dailyToday' : 'pushMsg.dailyTomorrow', language);
    const course = item.course_name ? ` (${item.course_name})` : '';
    return `${label} ${time.format(new Date(item.due_at!))}: ${item.title}${course}`;
  });
  if (due.length > MAX_LINES) lines.push(format(t('pushMsg.dailyMore', language), { count: due.length - MAX_LINES }));
  return {
    kind: 'daily_summary',
    title: format(t('pushMsg.dailyTitle', language), { today: count(today), tomorrow: count(tomorrow) }),
    body: lines.join('\n'),
    url: '/courses',
    tag: `daily-${today}`,
  };
}

interface CandidateRow {
  user_id: string;
  hour: number;
  last_sent_on: string | null;
  timezone: string | null;
  language: string;
}

/** Settings → Notifications → Daily summary, and the leader task that sends it. Deterministic: no model, no tokens. */
export class DailySummaryService {
  constructor(
    private db: Db,
    private canvas: CanvasService,
    private push: PushService,
    private t: Translate,
  ) {}

  async get(userId: string): Promise<DailySummarySetting & { devices: number; canvas_connected: boolean }> {
    const row = await maybe<{ enabled: boolean; hour: number; devices: number; canvas_connected: boolean }>(
      this.db,
      `SELECT COALESCE(d.enabled, false) AS enabled, COALESCE(d.hour, 7)::int AS hour,
         (SELECT COUNT(*)::int FROM push_subscriptions s WHERE s.user_id = u.id) AS devices,
         EXISTS (SELECT 1 FROM connections c WHERE c.user_id = u.id AND c.kind = 'canvas' AND c.secret_enc IS NOT NULL) AS canvas_connected
       FROM users u LEFT JOIN daily_summaries d ON d.user_id = u.id WHERE u.id = $1`,
      [userId],
    );
    return row ?? { enabled: false, hour: 7, devices: 0, canvas_connected: false };
  }

  async set(userId: string, setting: DailySummarySetting): Promise<void> {
    // last_sent_on is kept: turning it off and on again the same morning does not send twice.
    await this.db.query(
      `INSERT INTO daily_summaries (user_id, enabled, hour) VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET enabled = $2, hour = $3, updated_at = now()`,
      [userId, setting.enabled, setting.hour],
    );
  }

  /** "Send one now" in Settings: the same push, whatever the hour, without counting as today's. */
  async preview(userId: string, language: string): Promise<{ nothing_due: boolean; sent: number }> {
    const user = await maybe<{ timezone: string | null }>(this.db, 'SELECT timezone FROM users WHERE id = $1', [userId]);
    const now = new Date();
    const message = buildDigest(await this.canvas.upcoming(userId, 3), user?.timezone ?? null, language, this.t, now);
    if (!message) return { nothing_due: true, sent: 0 };
    return { nothing_due: false, sent: await this.push.notify(userId, message, { anyKind: true }) };
  }

  /** Leader task: sends today's summary to each student whose hour has come. Safe to run on any replica, any time. */
  async run(now = new Date()): Promise<void> {
    // Only students who can receive it and have something to build it from.
    const rows = await many<CandidateRow>(
      this.db,
      `SELECT d.user_id, d.hour, d.last_sent_on::text AS last_sent_on, u.timezone, u.language
       FROM daily_summaries d JOIN users u ON u.id = d.user_id
       WHERE d.enabled AND u.status = 'active'
         AND EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.user_id = d.user_id)
         AND EXISTS (SELECT 1 FROM connections c WHERE c.user_id = d.user_id AND c.kind = 'canvas' AND c.secret_enc IS NOT NULL)`,
    );
    let sent = 0;
    for (const row of rows) {
      const date = dueDate({ timezone: row.timezone, hour: row.hour, lastSentOn: row.last_sent_on }, now);
      if (!date) continue;
      let message: PushMessage | null;
      try {
        message = buildDigest(await this.canvas.upcoming(row.user_id, 3), row.timezone, row.language, this.t, now);
      } catch (err) {
        // Canvas down: try again on the next tick. A rejected token will not fix itself today: give up on today.
        const gaveUp = err instanceof AppError && (err.status === 412 || err.status === 424);
        if (!gaveUp) {
          logger.warn(`Daily summary for ${row.user_id} postponed: ${(err as Error).message}`);
          continue;
        }
        message = null;
      }
      // Claimed before sending: a crash can skip a day but never send it twice.
      const { rowCount } = await this.db.query(
        'UPDATE daily_summaries SET last_sent_on = $2 WHERE user_id = $1 AND last_sent_on IS DISTINCT FROM $2::date',
        [row.user_id, date],
      );
      if (!rowCount || !message) continue;
      if ((await this.push.notify(row.user_id, message, { anyKind: true })) > 0) sent++;
    }
    if (sent) logger.info(`Sent ${sent} daily summar${sent === 1 ? 'y' : 'ies'}`);
  }
}
