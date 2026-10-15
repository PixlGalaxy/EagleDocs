import type { Db } from '../../db/pool.js';
import { assertPublicUrl } from '../../engine/web.js';
import { maybe } from '../../db/pool.js';
import { AppError, withDetail } from '../../errors.js';
import type { ConnectionsService } from '../connections/connections.service.js';
import { CanvasClient, CanvasError, type CanvasAssignmentRaw, type CanvasCourseRaw } from './canvas.client.js';
import { estimateHours, priorityScore, stripHtml } from './priority.js';
import { Readable } from 'stream';
import type { DiskWorkspace } from '../../engine/workspace.js';

const MAX_DOWNLOAD_BYTES = 150 * 1024 * 1024;

/** frontend/src/api/types.ts `CanvasCourse` */
export interface CourseView {
  id: number;
  name: string;
  course_code: string;
  term: string | null;
  current_score: number | null;
  current_grade: string | null;
  /** In a term running now. Organization pages and past terms are false. */
  current: boolean;
}

/** frontend/src/api/types.ts `CanvasItem` */
export interface ItemView {
  id: string;
  course_id: number;
  course_name: string;
  kind: 'assignment' | 'quiz' | 'event' | 'discussion';
  title: string;
  due_at: string | null;
  points: number | null;
  submitted: boolean;
  missing: boolean;
  estimate_hours: number | null;
  priority: number | null;
  priority_label?: string;
  html_url: string;
}

export interface AnnouncementView {
  id: number;
  course_id: number;
  title: string;
  posted_at: string;
  preview: string;
  html_url: string;
}

/** Each replica keeps its own short cache: enough to spare Canvas from page refreshes and agent loops. */
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_COURSES = 20;
const PARALLEL = 4;

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        out[index] = await fn(items[index]!);
      }
    }),
  );
  return out;
}

/**
 * Whether the course belongs to a term running now, by the term's own dates.
 * Organization pages and trainings live in "Default Term" (no dates) even when
 * the course itself has dates, so a term without dates never counts as current.
 */
function isCurrent(c: CanvasCourseRaw, now: number): boolean {
  const start = c.term?.start_at;
  const end = c.term?.end_at;
  if (!start && !end) return false;
  return (!start || new Date(start).getTime() <= now) && (!end || new Date(end).getTime() >= now);
}

function toCourse(c: CanvasCourseRaw, now = Date.now()): CourseView {
  const enrollment = c.enrollments?.find((e) => e.type === 'student') ?? c.enrollments?.[0];
  return {
    id: c.id,
    name: c.name ?? `Course ${c.id}`,
    course_code: c.course_code ?? '',
    term: c.term?.name ?? null,
    current_score: enrollment?.computed_current_score ?? null,
    current_grade: enrollment?.computed_current_grade ?? null,
    current: isCurrent(c, now),
  };
}

/** Current-term courses first, then the rest, each group by name. */
function byRelevance(a: CourseView, b: CourseView): number {
  if (a.current !== b.current) return a.current ? -1 : 1;
  return a.name.localeCompare(b.name);
}

const PLANNER_KIND: Record<string, ItemView['kind']> = {
  assignment: 'assignment',
  quiz: 'quiz',
  discussion_topic: 'discussion',
  calendar_event: 'event',
  assessment_request: 'assignment',
};

function toItem(a: CanvasAssignmentRaw, courseName: string, now: Date): ItemView {
  const submitted = Boolean(a.submission?.submitted_at) || a.submission?.workflow_state === 'graded';
  const types = a.submission_types ?? [];
  const kind: ItemView['kind'] =
    a.is_quiz_assignment || types.includes('online_quiz') ? 'quiz' : types.includes('discussion_topic') ? 'discussion' : 'assignment';
  const input = { name: a.name ?? '', description: a.description, due_at: a.due_at, points_possible: a.points_possible, submission_types: types, submitted };
  const { score, label } = priorityScore(input, now);
  return {
    id: `assignment-${a.id}`,
    course_id: a.course_id,
    course_name: courseName,
    kind,
    title: a.name ?? 'Untitled',
    due_at: a.due_at ?? null,
    points: a.points_possible ?? null,
    submitted,
    missing: Boolean(a.submission?.missing),
    estimate_hours: estimateHours(input).hours,
    priority: score,
    priority_label: label,
    html_url: a.html_url ?? '',
  };
}

/** One student's Canvas, through their own token. Read-only. */
export class CanvasService {
  private cache = new Map<string, { at: number; value: unknown }>();

  constructor(private db: Db, private connections: ConnectionsService) {}

  /** The student's client, or a 412 the Courses page turns into "connect Canvas". */
  private async client(userId: string): Promise<{ client: CanvasClient; connectionId: string }> {
    const row = await maybe<{ id: string; secret_enc: Buffer | null; meta: { base_url?: string }; canvas_base_url: string | null }>(
      this.db,
      `SELECT c.id, c.secret_enc, c.meta, i.canvas_base_url FROM connections c
       JOIN users u ON u.id = c.user_id LEFT JOIN institutions i ON i.id = u.institution_id
       WHERE c.user_id = $1 AND c.kind = 'canvas' LIMIT 1`,
      [userId],
    );
    const baseUrl = row?.meta.base_url || row?.canvas_base_url;
    if (!row?.secret_enc || !baseUrl) throw new AppError(412, 'canvas.notConnected');
    const guard = row.meta.base_url ? assertPublicUrl : undefined;
    return { client: new CanvasClient(baseUrl, this.connections.secretOf(row as never), guard), connectionId: row.id };
  }

  /** Clears this user's cached answers (new token, or a manual refresh). */
  forget(userId: string): void {
    for (const key of this.cache.keys()) if (key.startsWith(`${userId}:`)) this.cache.delete(key);
  }

  private async cached<T>(userId: string, key: string, load: (client: CanvasClient) => Promise<T>): Promise<T> {
    // Resolve the connection before the cache: a forgotten token must stop answering at once.
    const { client, connectionId } = await this.client(userId);
    const cacheKey = `${userId}:${key}`;
    const hit = this.cache.get(cacheKey);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value as T;
    try {
      const value = await load(client);
      this.cache.set(cacheKey, { at: Date.now(), value });
      if (this.cache.size > 5000) this.cache.delete(this.cache.keys().next().value!);
      return value;
    } catch (err) {
      if (err instanceof CanvasError) {
        if (err.kind === 'auth') {
          await this.connections.markError(connectionId, err.message);
          throw new AppError(424, 'canvas.tokenRejected');
        }
        if (err.kind === 'not_found') throw new AppError(404, 'error.notFound');
        throw withDetail(new AppError(502, 'canvas.unavailable'), err.message);
      }
      throw err;
    }
  }

  courses(userId: string): Promise<CourseView[]> {
    return this.cached(userId, 'courses', async (client) =>
      (await client.activeCourses()).map((c) => toCourse(c)).sort(byRelevance).slice(0, MAX_COURSES),
    );
  }

  /**
   * Everything due in the next `days` days across courses (plus overdue work
   * not submitted in the last week), sorted by due date.
   */
  upcoming(userId: string, days: number): Promise<ItemView[]> {
    return this.cached(userId, `upcoming:${days}`, async (client) => {
      // One call to the Planner (what Canvas' own To Do list uses) instead of one per course.
      try {
        return await this.upcomingFromPlanner(client, days);
      } catch (err) {
        if (err instanceof CanvasError && err.kind === 'auth') throw err;
        // Older or restricted Canvas without the Planner: ask course by course.
      }
      const now = new Date();
      const until = now.getTime() + days * 86_400_000;
      const since = now.getTime() - 7 * 86_400_000;
      const courses = (await client.activeCourses()).slice(0, MAX_COURSES);
      const perCourse = await mapLimit(courses, PARALLEL, async (course) => {
        const list = await client.assignments(course.id).catch(() => [] as CanvasAssignmentRaw[]);
        return list.map((a) => toItem({ ...a, course_id: a.course_id ?? course.id }, course.name ?? '', now));
      });
      const items = perCourse.flat().filter((item) => {
        if (!item.due_at) return false;
        const due = new Date(item.due_at).getTime();
        if (due > until) return false;
        return due >= now.getTime() || (!item.submitted && due >= since);
      });

      // Calendar events (office hours, exams scheduled as events) without an assignment behind them.
      const events = await client.upcomingEvents().catch(() => []);
      for (const event of events) {
        if (event.assignment || !event.start_at) continue;
        const start = new Date(event.start_at).getTime();
        if (start < now.getTime() || start > until) continue;
        const courseId = Number(/^course_(\d+)$/.exec(event.context_code ?? '')?.[1] ?? 0);
        items.push({
          id: `event-${event.id}`,
          course_id: courseId,
          course_name: courses.find((c) => c.id === courseId)?.name ?? '',
          kind: 'event',
          title: event.title ?? 'Event',
          due_at: event.start_at,
          points: null,
          submitted: false,
          missing: false,
          estimate_hours: null,
          priority: null,
          html_url: event.html_url ?? '',
        });
      }
      return items.sort((a, b) => (a.due_at ?? '').localeCompare(b.due_at ?? ''));
    });
  }

  private async upcomingFromPlanner(client: CanvasClient, days: number): Promise<ItemView[]> {
    const now = new Date();
    const since = new Date(now.getTime() - 7 * 86_400_000);
    const until = new Date(now.getTime() + days * 86_400_000);
    const rows = await client.plannerItems(since, until);
    // The Planner returns relative links ("/courses/1/assignments/2"): point them at Canvas, not at us.
    const link = (url: string | undefined) => (url ? new URL(url, client.origin).toString() : '');
    const items: ItemView[] = [];
    for (const row of rows) {
      const kind = PLANNER_KIND[row.plannable_type];
      if (!kind) continue; // notes, pages and announcements are not work
      const due = row.plannable?.due_at ?? row.plannable_date ?? null;
      if (!due) continue;
      const sub = row.submissions || undefined;
      const submitted = Boolean(sub?.submitted || sub?.graded || sub?.excused);
      const dueMs = new Date(due).getTime();
      // Past items stay only when Canvas itself marks them missing (practice quizzes and 0-point items do not count).
      if (dueMs < now.getTime() && (submitted || kind === 'event' || !sub?.missing)) continue;
      const title = row.plannable?.title ?? 'Untitled';
      if (kind === 'event') {
        items.push({
          id: `event-${row.plannable_id}`,
          course_id: row.course_id ?? 0,
          course_name: row.context_name ?? '',
          kind,
          title,
          due_at: due,
          points: null,
          submitted: false,
          missing: false,
          estimate_hours: null,
          priority: null,
          html_url: link(row.html_url),
        });
        continue;
      }
      const types = kind === 'quiz' ? ['online_quiz'] : kind === 'discussion' ? ['discussion_topic'] : [];
      const input = { name: title, due_at: due, points_possible: row.plannable?.points_possible ?? null, submission_types: types, submitted };
      const { score, label } = priorityScore(input, now);
      items.push({
        id: `${kind === 'quiz' ? 'quiz' : 'assignment'}-${row.plannable_id}`,
        course_id: row.course_id ?? 0,
        course_name: row.context_name ?? '',
        kind,
        title,
        due_at: due,
        points: row.plannable?.points_possible ?? null,
        submitted,
        missing: Boolean(sub?.missing),
        estimate_hours: estimateHours(input).hours,
        priority: score,
        priority_label: label,
        html_url: link(row.html_url),
      });
    }
    return items.sort((a, b) => (a.due_at ?? '').localeCompare(b.due_at ?? ''));
  }

  async course(userId: string, courseId: number) {
    const courses = await this.courses(userId);
    const course = courses.find((c) => c.id === courseId);
    if (!course) throw new AppError(404, 'error.notFound');
    return this.cached(userId, `course:${courseId}`, async (client) => {
      const now = new Date();
      const [assignments, announcements] = await Promise.all([
        client.assignments(courseId),
        client.announcements([courseId], new Date(Date.now() - 30 * 86_400_000)).catch(() => []),
      ]);
      const items = assignments
        .map((a) => toItem({ ...a, course_id: courseId }, course.name, now))
        .sort((a, b) => {
          // Upcoming first (soonest first), then past work (most recent first), undated last.
          const ta = a.due_at ? new Date(a.due_at).getTime() : Infinity;
          const tb = b.due_at ? new Date(b.due_at).getTime() : Infinity;
          const fa = ta >= now.getTime();
          const fb = tb >= now.getTime();
          if (fa !== fb) return fa ? -1 : 1;
          return fa ? ta - tb : tb - ta;
        });
      return { course, items, announcements: announcements.map((a) => this.toAnnouncement(a, courseId)) };
    });
  }

  private toAnnouncement(a: { id: number; title?: string; message?: string | null; posted_at?: string | null; html_url?: string; context_code?: string }, fallbackCourse: number): AnnouncementView {
    const text = stripHtml(a.message);
    return {
      id: a.id,
      course_id: Number(/^course_(\d+)$/.exec(a.context_code ?? '')?.[1] ?? fallbackCourse),
      title: a.title ?? 'Announcement',
      posted_at: a.posted_at ?? '',
      preview: text.length > 400 ? `${text.slice(0, 400)}...` : text,
      html_url: a.html_url ?? '',
    };
  }

  /** Everything the course folders need in two calls: assignments with their instructions, and recent announcements. */
  async courseSnapshot(userId: string, courseId: number) {
    return this.cached(userId, `snapshot:${courseId}`, async (client) => {
      const [assignments, announcements] = await Promise.all([
        client.assignments(courseId),
        client.announcements([courseId], new Date(Date.now() - 30 * 86_400_000)).catch(() => []),
      ]);
      return {
        assignments: assignments.map((a) => ({
          id: a.id,
          title: a.name ?? 'Assignment',
          due_at: a.due_at ?? null,
          points: a.points_possible ?? null,
          submitted: Boolean(a.submission?.submitted_at),
          missing: Boolean(a.submission?.missing),
          score: a.submission?.score ?? null,
          submission_types: (a.submission_types ?? []).filter((t) => t !== 'none'),
          url: a.html_url ?? '',
          description: stripHtml(a.description).slice(0, 20_000),
        })),
        announcements: announcements
          .map((a) => ({ title: a.title ?? 'Announcement', posted_at: a.posted_at ?? null, html_url: a.html_url ?? '', text: stripHtml(a.message).slice(0, 4000) }))
          .sort((a, b) => (b.posted_at ?? '').localeCompare(a.posted_at ?? '')),
      };
    });
  }

  // ---------------------------------------------------------------- for the agent

  async announcements(userId: string, courseId: number | null, days: number) {
    const courses = await this.courses(userId);
    const ids = courseId ? [courseId] : courses.map((c) => c.id);
    return this.cached(userId, `announcements:${ids.join(',')}:${days}`, async (client) => {
      const list = await client.announcements(ids, new Date(Date.now() - days * 86_400_000));
      return list
        .map((a) => {
          const view = this.toAnnouncement(a, ids[0] ?? 0);
          return { ...view, course_name: courses.find((c) => c.id === view.course_id)?.name ?? '', text: stripHtml(a.message).slice(0, 3000) };
        })
        .sort((a, b) => b.posted_at.localeCompare(a.posted_at));
    });
  }

  modules(userId: string, courseId: number) {
    return this.cached(userId, `modules:${courseId}`, async (client) =>
      (await client.modules(courseId)).map((m) => ({
        name: m.name,
        state: m.state ?? null,
        items: (m.items ?? []).map((i) => ({ title: i.title, type: i.type, completed: i.completion_requirement?.completed ?? null, url: i.html_url })),
      })),
    );
  }

  assignmentDetail(userId: string, courseId: number, assignmentId: number) {
    return this.cached(userId, `assignment:${courseId}:${assignmentId}`, async (client) => {
      const a = await client.assignment(courseId, assignmentId);
      const { hours, reason } = estimateHours({ name: a.name ?? '', description: a.description, points_possible: a.points_possible, submission_types: a.submission_types, submitted: false });
      return {
        title: a.name,
        due_at: a.due_at ?? null,
        points: a.points_possible ?? null,
        submission_types: a.submission_types ?? [],
        submitted: Boolean(a.submission?.submitted_at),
        score: a.submission?.score ?? null,
        estimate: { hours, reason },
        description: stripHtml(a.description).slice(0, 8000),
        rubric: (a.rubric ?? []).map((r) => ({ criterion: r.description, points: r.points })),
        url: a.html_url,
      };
    });
  }

  courseFiles(userId: string, courseId: number) {
    return this.cached(userId, `files:${courseId}`, async (client) =>
      (await client.courseFiles(courseId)).map((f) => ({
        id: f.id,
        name: f.display_name ?? f.filename ?? `file-${f.id}`,
        size_mb: Math.round(((f.size ?? 0) / 1048576) * 100) / 100,
        type: f['content-type'] ?? null,
        updated: f.updated_at ?? null,
        locked: Boolean(f.locked_for_user || !f.url),
      })),
    );
  }

  /**
   * Saves a course's pages as Markdown-ish text files (for rag_add or reading
   * later). Many courses keep their material in pages, not files; the files
   * those pages link to come back as ids for downloadFile.
   */
  async savePages(userId: string, courseId: number, folder: string, workspace: DiskWorkspace, max: number) {
    const { client } = await this.client(userId);
    const pages = (await client.pages(courseId)).slice(0, max);
    const dir = folder.replace(/\/+$/, '');
    const saved: { path: string; title: string; chars: number }[] = [];
    const skipped: { title: string; reason: string }[] = [];
    const linked = new Set<number>();
    const used = new Set<string>();
    await mapLimit(pages, 4, async ({ url, title }) => {
      try {
        const page = await client.page(courseId, url);
        if (page.locked_for_user || !page.body) return void skipped.push({ title, reason: page.locked_for_user ? 'locked' : 'empty' });
        for (const m of page.body.matchAll(/\/files\/(\d+)/g)) linked.add(Number(m[1]));
        const text = stripHtml(page.body);
        if (text.length < 40) return void skipped.push({ title, reason: 'almost empty' });
        let name = (page.title ?? title).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim().slice(0, 120) || url;
        while (used.has(name.toLowerCase())) name += '_';
        used.add(name.toLowerCase());
        const link = page.html_url ? new URL(page.html_url, client.origin).toString() : '';
        const path = `${dir}/${name}.md`;
        const source = link ? `Source: ${link}\n\n` : '';
        await workspace.write(userId, path, `# ${page.title ?? title}\n\n${source}${text}\n`);
        saved.push({ path, title: page.title ?? title, chars: text.length });
      } catch (err) {
        skipped.push({ title, reason: (err as Error).message.slice(0, 120) });
      }
    });
    return { linked_file_ids: [...linked].slice(0, 50), saved, skipped };
  }

  /** Streams one Canvas file into the user's workspace (normally TEMP/). Read-only on Canvas. */
  async downloadFile(userId: string, fileId: number, folder: string, workspace: DiskWorkspace): Promise<{ path: string; bytes: number }> {
    const { client, connectionId } = await this.client(userId);
    try {
      const file = await client.file(fileId);
      const name = (file.display_name ?? file.filename ?? `file-${fileId}`).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').slice(0, 150);
      const res = await client.download(file, MAX_DOWNLOAD_BYTES);
      const path = `${folder.replace(/\/+$/, '')}/${name}`;
      const bytes = await workspace.writeStream(userId, path, Readable.fromWeb(res.body as never), MAX_DOWNLOAD_BYTES);
      return { path, bytes };
    } catch (err) {
      if (err instanceof CanvasError && err.kind === 'auth' && err.status === 401) {
        await this.connections.markError(connectionId, err.message);
        throw new AppError(424, 'canvas.tokenRejected');
      }
      throw err;
    }
  }

  /** Connects (or replaces) the student's token after checking it against their Canvas. */
  async saveToken(userId: string, token: string, baseUrlOverride: string | undefined) {
    const row = await maybe<{ canvas_base_url: string | null }>(
      this.db,
      'SELECT i.canvas_base_url FROM users u LEFT JOIN institutions i ON i.id = u.institution_id WHERE u.id = $1',
      [userId],
    );
    const baseUrl = baseUrlOverride || row?.canvas_base_url;
    if (!baseUrl) throw new AppError(400, 'canvas.noBaseUrl');
    let profile: { name?: string };
    try {
      profile = await new CanvasClient(baseUrl, token, baseUrlOverride ? assertPublicUrl : undefined).profile();
    } catch (err) {
      if (err instanceof CanvasError && err.kind === 'auth') throw new AppError(400, 'canvas.tokenRejected');
      throw withDetail(new AppError(502, 'canvas.unavailable'), (err as Error).message);
    }
    this.forget(userId);
    return this.connections.saveSecret(userId, 'canvas', {
      label: 'Canvas',
      secret: token,
      meta: { name: profile.name ?? null, base_url: baseUrlOverride ?? null, token_hint: `...${token.slice(-4)}` },
      status: 'ok',
    });
  }
}
