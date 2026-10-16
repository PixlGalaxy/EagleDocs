import type { Db } from '../../db/pool.js';
import { many, maybe } from '../../db/pool.js';
import type { DiskWorkspace } from '../../engine/workspace.js';
import { logger } from '../../logger.js';
import type { CanvasService, CourseView } from './canvas.service.js';

/** Between automatic syncs of one student's course folders. */
export const SYNC_EVERY_HOURS = 6;
const GENERATED_NOTE = '_Kept up to date from Canvas by StudyHawk. Changes here are replaced on the next sync; keep your own notes in other files._';

export interface SyncResult {
  term: string;
  courses: { name: string; folder: string; assignments: number }[];
  written: number;
}

/** "Fall 2026" from the date when Canvas has no term name. */
export function termFor(date: Date): string {
  const month = date.getUTCMonth();
  const season = month <= 4 ? 'Spring' : month <= 6 ? 'Summer' : 'Fall';
  return `${season} ${date.getUTCFullYear()}`;
}

/** A name every file system accepts, readable, without the term repeated. */
export function folderName(text: string, term?: string): string {
  let name = text;
  if (term) name = name.replace(new RegExp(`\\s*[\\(\\[-]?\\s*${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[\\)\\]]?`, 'i'), '');
  name = name
    .replace(/[\\/:*?"<>|#%]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 70)
    .trim();
  return name || 'Course';
}

function day(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return 'No date';
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

function when(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return 'No due date';
  return new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

const cell = (text: string) => text.replace(/\|/g, '/').replace(/\s+/g, ' ').trim();

/**
 * Keeps "<Term>/<Course>/" folders in the student's files: Assignments.md (all
 * of them, with status), one file per assignment with its instructions, and
 * Announcements.md. Only the current term's courses; past terms stay as they
 * were. Files are rewritten only when their content changed.
 */
export class CourseFolders {
  /** A sync in progress per student: a second request waits for it instead of starting another. */
  private running = new Map<string, Promise<SyncResult>>();

  constructor(
    private db: Db,
    private canvas: CanvasService,
    private workspace: DiskWorkspace,
  ) {}

  /** Last sync, for the Courses page. */
  status(userId: string) {
    return maybe<{ synced_at: Date | null; term: string | null; courses: number; error: string | null }>(
      this.db,
      'SELECT synced_at, term, courses, error FROM canvas_sync WHERE user_id = $1',
      [userId],
    );
  }

  sync(userId: string): Promise<SyncResult> {
    const inFlight = this.running.get(userId);
    if (inFlight) return inFlight;
    const run = this.run(userId).finally(() => this.running.delete(userId));
    this.running.set(userId, run);
    return run;
  }

  private async run(userId: string): Promise<SyncResult> {
    try {
      const result = await this.write(userId);
      await this.db.query(
        `INSERT INTO canvas_sync (user_id, synced_at, term, courses, error) VALUES ($1, now(), $2, $3, NULL)
         ON CONFLICT (user_id) DO UPDATE SET synced_at = now(), term = $2, courses = $3, error = NULL`,
        [userId, result.term, result.courses.length],
      );
      return result;
    } catch (err) {
      const message = (err as Error).message.slice(0, 300);
      await this.db
        .query(
          `INSERT INTO canvas_sync (user_id, synced_at, error) VALUES ($1, now(), $2)
           ON CONFLICT (user_id) DO UPDATE SET synced_at = now(), error = $2`,
          [userId, message],
        )
        .catch(() => undefined);
      throw err;
    }
  }

  private async write(userId: string): Promise<SyncResult> {
    const user = await maybe<{ timezone: string | null }>(this.db, 'SELECT timezone FROM users WHERE id = $1', [userId]);
    const timeZone = user?.timezone || 'America/New_York';
    const current = (await this.canvas.courses(userId)).filter((c) => c.current);
    const term = current.find((c) => c.term)?.term ?? termFor(new Date());
    const result: SyncResult = { term, courses: [], written: 0 };
    for (const course of current) {
      const folder = `${folderName(course.term ?? term)}/${folderName(course.name || course.course_code, course.term ?? term)}`;
      const written = await this.writeCourse(userId, course, folder, timeZone);
      result.courses.push({ name: course.name, folder, assignments: written.assignments });
      result.written += written.files;
    }
    return result;
  }

  private async writeCourse(userId: string, course: CourseView, folder: string, timeZone: string) {
    const { assignments, announcements } = await this.canvas.courseSnapshot(userId, course.id);
    let files = 0;
    const put = async (path: string, text: string) => {
      const existing = await this.workspace.read(userId, path).then((b) => b.toString('utf8'), () => null);
      if (existing === text) return;
      await this.workspace.write(userId, path, text);
      files++;
    };

    const sorted = [...assignments].sort((a, b) => (a.due_at ? Date.parse(a.due_at) : Infinity) - (b.due_at ? Date.parse(b.due_at) : Infinity));
    const now = Date.now();
    const rows: string[] = [];
    const usedNames = new Set<string>();
    for (const a of sorted) {
      let file = `${day(a.due_at, timeZone)} ${folderName(a.title)}`;
      while (usedNames.has(file)) file += ` (${a.id})`;
      usedNames.add(file);
      const status = a.submitted ? 'Submitted' : a.missing ? 'Missing' : a.due_at && Date.parse(a.due_at) < now ? 'Past due' : 'To do';
      rows.push(`| ${cell(when(a.due_at, timeZone))} | [${cell(a.title)}](<Assignments/${file}.md>) | ${a.points ?? ''} | ${status} |`);
      await put(
        `${folder}/Assignments/${file}.md`,
        [
          `# ${a.title}`,
          '',
          `- Course: ${course.name}`,
          `- Due: ${when(a.due_at, timeZone)}`,
          `- Points: ${a.points ?? 'not set'}`,
          `- Status: ${status}${a.score != null ? ` (score ${a.score})` : ''}`,
          `- Submit as: ${a.submission_types.join(', ') || 'not set'}`,
          `- Canvas: ${a.url}`,
          '',
          '## Instructions',
          '',
          a.description || '_No instructions in Canvas._',
          '',
          GENERATED_NOTE,
          '',
        ].join('\n'),
      );
    }

    await put(
      `${folder}/Assignments.md`,
      [
        `# ${course.name}: assignments`,
        '',
        course.current_grade || course.current_score != null ? `Current grade: ${course.current_grade ?? ''} ${course.current_score != null ? `(${course.current_score}%)` : ''}`.trim() + '\n' : '',
        rows.length ? '| Due | Assignment | Points | Status |\n|---|---|---:|---|\n' + rows.join('\n') : '_No assignments in Canvas yet._',
        '',
        GENERATED_NOTE,
        '',
      ].join('\n'),
    );

    await put(
      `${folder}/Announcements.md`,
      [
        `# ${course.name}: announcements (last 30 days)`,
        '',
        ...(announcements.length
          ? announcements.map((n) => `## ${n.title}\n\n${when(n.posted_at, timeZone)} · [Canvas](${n.html_url})\n\n${n.text}\n`)
          : ['_No announcements in the last 30 days._', '']),
        GENERATED_NOTE,
        '',
      ].join('\n'),
    );
    return { assignments: assignments.length, files };
  }
}

/** Leader task: refresh the folders of students with Canvas connected, oldest sync first. */
export async function syncDueCourseFolders(db: Db, folders: CourseFolders): Promise<void> {
  const due = await many<{ user_id: string }>(
    db,
    `SELECT c.user_id FROM connections c JOIN users u ON u.id = c.user_id
       LEFT JOIN canvas_sync s ON s.user_id = c.user_id
      WHERE c.kind = 'canvas' AND c.status = 'ok' AND u.status = 'active'
        AND (s.synced_at IS NULL OR s.synced_at < now() - make_interval(hours => $1))
      ORDER BY s.synced_at NULLS FIRST LIMIT 25`,
    [SYNC_EVERY_HOURS],
  );
  for (const { user_id } of due) {
    await folders.sync(user_id).catch((err: Error) => logger.warn(`Course folders for ${user_id} not synced: ${err.message}`));
  }
}
