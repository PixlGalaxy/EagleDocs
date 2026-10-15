/**
 * Read-only Canvas REST client. Only GET exists here on purpose: EagleDocs
 * never changes anything in a student's Canvas. Ported from the canvas-lms
 * skill (per_page=100, `Link: rel="next"` pagination, 30 s timeout).
 */
import { assertPublicUrl } from '../../engine/web.js';

export class CanvasError extends Error {
  constructor(
    message: string,
    /** 'auth': the token is invalid, expired or tokens are disabled at the school. */
    readonly kind: 'auth' | 'not_found' | 'rate_limit' | 'network' | 'server',
    readonly status?: number,
  ) {
    super(message);
  }
}

export interface CanvasCourseRaw {
  id: number;
  name?: string;
  course_code?: string;
  access_restricted_by_date?: boolean;
  term?: { name?: string; start_at?: string | null; end_at?: string | null } | null;
  start_at?: string | null;
  end_at?: string | null;
  enrollments?: { type?: string; computed_current_score?: number | null; computed_current_grade?: string | null }[];
}

export interface CanvasAssignmentRaw {
  id: number;
  course_id: number;
  name?: string;
  description?: string | null;
  due_at?: string | null;
  points_possible?: number | null;
  submission_types?: string[];
  html_url?: string;
  is_quiz_assignment?: boolean;
  quiz_id?: number;
  discussion_topic?: unknown;
  submission?: { submitted_at?: string | null; missing?: boolean; workflow_state?: string; score?: number | null; grade?: string | null } | null;
  rubric?: { description?: string; points?: number }[];
}

export interface CanvasEventRaw {
  id: string | number;
  title?: string;
  start_at?: string | null;
  end_at?: string | null;
  context_code?: string;
  html_url?: string;
  assignment?: CanvasAssignmentRaw;
  type?: string;
}

/** One row of the student's Planner (Canvas' own To Do list): every course in one paginated call. */
export interface PlannerItemRaw {
  course_id?: number;
  context_name?: string;
  plannable_id: number | string;
  plannable_type: string;
  plannable_date?: string | null;
  html_url?: string;
  plannable?: { id: number | string; title?: string; points_possible?: number | null; due_at?: string | null; todo_date?: string | null };
  submissions?:
    | false
    | { submitted?: boolean; excused?: boolean; graded?: boolean; missing?: boolean; late?: boolean; needs_grading?: boolean };
}

export interface CanvasFileRaw {
  id: number;
  display_name?: string;
  filename?: string;
  size?: number;
  'content-type'?: string;
  url?: string;
  updated_at?: string;
  folder_id?: number;
  locked_for_user?: boolean;
}

export interface CanvasAnnouncementRaw {
  id: number;
  title?: string;
  message?: string | null;
  posted_at?: string | null;
  context_code?: string;
  html_url?: string;
}

export interface CanvasPageRaw {
  url: string;
  title?: string;
  body?: string | null;
  html_url?: string;
  updated_at?: string;
  locked_for_user?: boolean;
}

export interface CanvasModuleRaw {
  id: number;
  name?: string;
  state?: string;
  items?: { id: number; title?: string; type?: string; html_url?: string; content_id?: number; page_url?: string; completion_requirement?: { completed?: boolean } }[];
}

const TIMEOUT_MS = 30_000;
const MAX_PAGES = 20;

function nextLink(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(',')) {
    if (part.includes('rel="next"')) {
      const match = /<([^>]+)>/.exec(part);
      return match ? match[1]! : null;
    }
  }
  return null;
}

export class CanvasClient {
  /** The school's Canvas, e.g. https://fgcu.instructure.com. */
  readonly origin: string;

  /**
   * `guard` vets every address first: set when the student typed the Canvas
   * address themselves (it could point inside the network). The school's own
   * Canvas, set by an admin, is trusted.
   */
  constructor(baseUrl: string, private token: string, private guard?: (url: string) => Promise<void>) {
    this.origin = new URL(baseUrl).origin;
  }

  /** GET with pagination; lists are concatenated across pages. */
  async get<T>(path: string, params: Record<string, string | number | string[]> = {}): Promise<T> {
    const query = new URLSearchParams();
    query.set('per_page', '100');
    for (const [key, value] of Object.entries(params)) {
      if (Array.isArray(value)) for (const v of value) query.append(key, v);
      else query.set(key, String(value));
    }
    let url: string | null = `${this.origin}/api/v1/${path.replace(/^\/+/, '')}?${query}`;
    const items: unknown[] = [];
    for (let page = 0; url && page < MAX_PAGES; page++) {
      const res = await this.fetchWithRetry(url);
      const data = (await res.json()) as unknown;
      if (!Array.isArray(data)) return data as T;
      items.push(...data);
      const next = nextLink(res.headers.get('link'));
      // Never follow a link off the school's Canvas: the token would go with it.
      url = next && new URL(next).origin === this.origin ? next : null;
    }
    return items as T;
  }

  private async fetchWithRetry(url: string): Promise<Response> {
    await this.guard?.(url);
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await fetch(url, {
          method: 'GET',
          headers: { authorization: `Bearer ${this.token}`, accept: 'application/json' },
          signal: AbortSignal.timeout(TIMEOUT_MS),
          redirect: 'manual',
        });
      } catch (err) {
        if (attempt < 2) continue;
        throw new CanvasError(`Canvas did not answer (${(err as Error).name})`, 'network');
      }
      if (res.ok) return res;
      if (res.status === 401 || res.status === 403) {
        throw new CanvasError('Canvas rejected the access token: it may be invalid, expired, or tokens may be disabled at your school.', 'auth', res.status);
      }
      if (res.status === 404) throw new CanvasError('Not found in Canvas', 'not_found', 404);
      if (res.status === 429 && attempt < 3) {
        const wait = Number(res.headers.get('retry-after')) || 2 ** attempt;
        await new Promise((r) => setTimeout(r, Math.min(10, wait) * 1000));
        continue;
      }
      if (res.status >= 500 && attempt < 2) continue;
      throw new CanvasError(`Canvas error ${res.status}`, res.status === 429 ? 'rate_limit' : 'server', res.status);
    }
  }

  profile() {
    return this.get<{ id: number; name?: string; primary_email?: string; time_zone?: string }>('users/self/profile');
  }

  async activeCourses(): Promise<CanvasCourseRaw[]> {
    const courses = await this.get<CanvasCourseRaw[]>('courses', {
      enrollment_state: 'active',
      'include[]': ['term', 'total_scores'],
    });
    return courses.filter((c) => c.name && !c.access_restricted_by_date);
  }

  assignments(courseId: number, bucket?: 'upcoming' | 'future' | 'past' | 'overdue' | 'undated' | 'unsubmitted') {
    return this.get<CanvasAssignmentRaw[]>(`courses/${courseId}/assignments`, {
      'include[]': ['submission'],
      ...(bucket && { bucket }),
      order_by: 'due_at',
    });
  }

  assignment(courseId: number, assignmentId: number) {
    return this.get<CanvasAssignmentRaw>(`courses/${courseId}/assignments/${assignmentId}`, { 'include[]': ['submission'] });
  }

  upcomingEvents() {
    return this.get<CanvasEventRaw[]>('users/self/upcoming_events');
  }

  /** Everything on the student's Planner between two dates (assignments, quizzes, discussions, events). */
  plannerItems(start: Date, end: Date) {
    return this.get<PlannerItemRaw[]>('planner/items', { start_date: start.toISOString(), end_date: end.toISOString() });
  }

  announcements(courseIds: number[], startDate: Date) {
    if (courseIds.length === 0) return Promise.resolve([] as CanvasAnnouncementRaw[]);
    return this.get<CanvasAnnouncementRaw[]>('announcements', {
      'context_codes[]': courseIds.map((id) => `course_${id}`),
      start_date: startDate.toISOString(),
      end_date: new Date(Date.now() + 86_400_000).toISOString(),
    });
  }

  /** Files of a course. Many schools hide the Files tab from students (403): then fall back to files linked in modules. */
  async courseFiles(courseId: number): Promise<CanvasFileRaw[]> {
    try {
      return await this.get<CanvasFileRaw[]>(`courses/${courseId}/files`, { sort: 'updated_at', order: 'desc' });
    } catch (err) {
      if (!(err instanceof CanvasError) || (err.kind !== 'auth' && err.kind !== 'not_found') || err.status === 401) throw err;
      const modules = await this.modules(courseId);
      const ids = new Set<number>();
      for (const m of modules) for (const item of m.items ?? []) if (item.type === 'File' && item.content_id) ids.add(item.content_id);
      const files: CanvasFileRaw[] = [];
      for (const id of ids) {
        try {
          files.push(await this.file(id));
        } catch {
          // Locked or deleted: skip.
        }
      }
      return files;
    }
  }

  file(fileId: number) {
    return this.get<CanvasFileRaw>(`files/${fileId}`);
  }

  /**
   * Downloads a file's bytes. Canvas answers with a redirect to its file
   * store (a signed URL): the token is only ever sent to Canvas itself.
   */
  async download(file: CanvasFileRaw, maxBytes: number): Promise<Response> {
    if (!file.url) throw new CanvasError('This file cannot be downloaded (locked or not published)', 'not_found');
    if ((file.size ?? 0) > maxBytes) throw new CanvasError(`The file is too large (${Math.round((file.size ?? 0) / 1048576)} MB)`, 'server');
    let url = file.url;
    for (let hop = 0; hop < 5; hop++) {
      const sameOrigin = new URL(url).origin === this.origin;
      // Off Canvas (its file store) only public https addresses, whoever set the Canvas address.
      if (!sameOrigin && new URL(url).protocol !== 'https:') throw new CanvasError('This file cannot be downloaded', 'server');
      if (!sameOrigin || this.guard) {
        try {
          await assertPublicUrl(url);
        } catch {
          throw new CanvasError('This file cannot be downloaded', 'server');
        }
      }
      const res = await fetch(url, {
        headers: sameOrigin ? { authorization: `Bearer ${this.token}` } : {},
        redirect: 'manual',
        signal: AbortSignal.timeout(120_000),
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        url = new URL(res.headers.get('location')!, url).toString();
        continue;
      }
      if (res.status === 401 || res.status === 403) throw new CanvasError('Canvas did not allow downloading this file', 'auth', res.status);
      if (!res.ok || !res.body) throw new CanvasError(`Download failed (${res.status})`, 'server', res.status);
      return res;
    }
    throw new CanvasError('Too many redirects', 'server');
  }

  /** A course's wiki pages (no bodies). Hidden Pages tab (403): the pages linked in modules. */
  async pages(courseId: number): Promise<{ url: string; title: string }[]> {
    try {
      const list = await this.get<CanvasPageRaw[]>(`courses/${courseId}/pages`, { published: 'true' });
      return list.map((p) => ({ url: p.url, title: p.title ?? p.url }));
    } catch (err) {
      if (!(err instanceof CanvasError) || (err.kind !== 'auth' && err.kind !== 'not_found') || err.status === 401) throw err;
      const seen = new Set<string>();
      const out: { url: string; title: string }[] = [];
      for (const m of await this.modules(courseId)) {
        for (const item of m.items ?? []) {
          if (item.type !== 'Page' || !item.page_url || seen.has(item.page_url)) continue;
          seen.add(item.page_url);
          out.push({ url: item.page_url, title: item.title ?? item.page_url });
        }
      }
      return out;
    }
  }

  page(courseId: number, url: string) {
    return this.get<CanvasPageRaw>(`courses/${courseId}/pages/${encodeURIComponent(url)}`);
  }

  modules(courseId: number) {
    return this.get<CanvasModuleRaw[]>(`courses/${courseId}/modules`, { 'include[]': ['items'] });
  }
}
