import { defineTool, type Tool, type ToolContext } from 'pixlai-engine';
import { AppError } from '../../errors.js';
import type { CanvasService } from '../../modules/canvas/canvas.service.js';
import type { CourseSpaces } from '../../modules/canvas/course-spaces.js';
import type { DiskWorkspace } from '../workspace.js';

/** What the worker puts in `host.canvas` for each run. */
export interface CanvasHost {
  service: CanvasService;
  userId: string;
  workspace: DiskWorkspace;
  /** Each current course's workspace folder. */
  spaces: CourseSpaces;
}

function canvasOf(ctx: ToolContext): CanvasHost {
  const host = ctx.host.canvas as CanvasHost | undefined;
  if (!host) throw new Error('Canvas is not available in this run');
  return host;
}

/** Turns the API's errors into instructions the model can act on. */
async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AppError) {
      if (err.key === 'canvas.notConnected') {
        throw new Error('Canvas is not connected. Tell the user to add their Canvas access token in Settings > Connections.');
      }
      if (err.key === 'canvas.tokenRejected') {
        throw new Error('Canvas rejected the saved token (expired or revoked). Ask the user to create a new one in Settings > Connections.');
      }
      if (err.key === 'error.notFound') throw new Error('Not found in Canvas. Check the course or assignment id with canvas_courses.');
      throw new Error('Canvas is not answering right now. Try again later.');
    }
    throw err;
  }
}

const courseId = { type: 'integer', description: 'Canvas course id (from canvas_courses)' };

/**
 * Due dates as the student reads them: local time in their timezone plus how
 * far away it is. Models are unreliable at converting UTC themselves.
 */
function when(iso: string | null, ctx: ToolContext): { due_local: string | null; due_in: string | null } {
  if (!iso) return { due_local: null, due_in: null };
  const date = new Date(iso);
  const due_local = new Intl.DateTimeFormat('en-US', {
    timeZone: ctx.user.timezone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
  const hours = (date.getTime() - ctx.clock.now().getTime()) / 3_600_000;
  const abs = Math.abs(hours);
  const span = abs < 48 ? `${Math.round(abs)} hours` : `${Math.round(abs / 24)} days`;
  return { due_local, due_in: hours >= 0 ? `in ${span}` : `${span} ago (overdue)` };
}

export const canvasCourses = defineTool({
  name: 'canvas_courses',
  description:
    "The student's active Canvas courses with term and current grade. `current: true` marks this term's classes; " +
    'the others are past terms or organization pages. Use the ids with the other canvas_ tools. ' +
    "This term's courses also carry `folder`: the course's workspace folder (Canvas/, Work/, Assignments/, Notes/).",
  parameters: { type: 'object', properties: {} },
  sideEffect: 'none',
  parallelSafe: true,
  async run(_args, ctx) {
    const { service, userId, spaces } = canvasOf(ctx);
    const courses = await call(() => service.courses(userId));
    const folders = new Map((await spaces.ensure(userId).catch(() => [])).map((s) => [s.id, s.folder]));
    return courses.map((c) => (folders.has(c.id) ? { ...c, folder: folders.get(c.id) } : c));
  },
});

export const canvasUpcoming = defineTool<{ days?: number }>({
  name: 'canvas_upcoming',
  description:
    'Assignments, quizzes and events due in the next days across all courses (plus overdue work not yet submitted), ' +
    'with points, submission status, estimated hours and a 0-100 priority score.',
  parameters: {
    type: 'object',
    properties: { days: { type: 'integer', description: 'How far ahead, 1-60 (default 14)' } },
  },
  sideEffect: 'none',
  parallelSafe: true,
  async run(args, ctx) {
    const { service, userId } = canvasOf(ctx);
    const days = Math.min(60, Math.max(1, Number(args.days) || 14));
    const items = await call(() => service.upcoming(userId, days));
    return items.map((i) => ({ ...i, ...when(i.due_at, ctx) }));
  },
});

export const canvasCourse = defineTool<{ course_id: number }>({
  name: 'canvas_course',
  description:
    'One course in detail: all its assignments (upcoming first, then past with scores) and the last 30 days of announcements. ' +
    "For what the student turned in and the teacher's feedback, use canvas_submissions.",
  parameters: { type: 'object', properties: { course_id: courseId }, required: ['course_id'] },
  sideEffect: 'none',
  untrusted: true,
  parallelSafe: true,
  async run(args, ctx) {
    const { service, userId } = canvasOf(ctx);
    return call(() => service.course(userId, Number(args.course_id)));
  },
});

export const canvasAssignment = defineTool<{ course_id: number; assignment_id: number }>({
  name: 'canvas_assignment',
  description:
    'Full instructions of one assignment or quiz: description as text, rubric, points, submission types, an effort estimate, ' +
    '`links` (the files with their link text and file_id, the pages and assignment_ids the instructions point to) and ' +
    '`in_modules` (where it sits). ' +
    'When the instructions say the questions or material are elsewhere (a packet, "see Files", "in Modules"), open the links ' +
    '(canvas_download for files, canvas_page for pages) or search with canvas_find before asking the student.',
  parameters: {
    type: 'object',
    properties: { course_id: courseId, assignment_id: { type: 'integer', description: 'Assignment id (the number in "assignment-123")' } },
    required: ['course_id', 'assignment_id'],
  },
  sideEffect: 'none',
  untrusted: true,
  parallelSafe: true,
  async run(args, ctx) {
    const { service, userId } = canvasOf(ctx);
    return call(() => service.assignmentDetail(userId, Number(args.course_id), Number(args.assignment_id)));
  },
});

export const canvasAnnouncements = defineTool<{ course_id?: number; days?: number }>({
  name: 'canvas_announcements',
  description: 'Recent announcements from one course or all courses, newest first, as plain text.',
  parameters: {
    type: 'object',
    properties: { course_id: courseId, days: { type: 'integer', description: 'How far back, 1-90 (default 14)' } },
  },
  sideEffect: 'none',
  untrusted: true,
  parallelSafe: true,
  async run(args, ctx) {
    const { service, userId } = canvasOf(ctx);
    const days = Math.min(90, Math.max(1, Number(args.days) || 14));
    return call(() => service.announcements(userId, args.course_id ? Number(args.course_id) : null, days));
  },
});

export const canvasModules = defineTool<{ course_id: number }>({
  name: 'canvas_modules',
  description:
    "A course's modules and their items, with completion when Canvas tracks it. Each item carries what opens it: " +
    '`file_id` (canvas_download), `page_url` (canvas_page), `assignment_id` (canvas_assignment), `quiz_id`, `external_url`.',
  parameters: { type: 'object', properties: { course_id: courseId }, required: ['course_id'] },
  sideEffect: 'none',
  untrusted: true,
  parallelSafe: true,
  async run(args, ctx) {
    const { service, userId } = canvasOf(ctx);
    return call(() => service.modules(userId, Number(args.course_id)));
  },
});

/**
 * The canvas-lms skill's briefing: everything due soon, ranked by priority,
 * with the reasoning, ready for the model to turn into a plan.
 */
export const canvasBriefing = defineTool<{ days?: number }>({
  name: 'canvas_briefing',
  description:
    'Prioritized briefing of what is due (default next 7 days): top items ranked by priority = 0.45 urgency + 0.25 weight + ' +
    '0.20 effort + 0.10 status, with estimated hours and why. Use it for "what do I have due", "what should I do first" or ' +
    "weekly plans. Times are already in the student's timezone (due_local, due_in): quote them as given. " +
    'Answer with: ## Urgent (top items: due, estimate, why it matters, next step), ## This week, ## Suggested plan ' +
    '(today / tomorrow / weekend). Explain the top 3 in plain language.',
  parameters: { type: 'object', properties: { days: { type: 'integer', description: 'How far ahead, 1-30 (default 7)' } } },
  sideEffect: 'none',
  parallelSafe: true,
  async run(args, ctx) {
    const { service, userId } = canvasOf(ctx);
    const days = Math.min(30, Math.max(1, Number(args.days) || 7));
    const [courses, items] = await call(() => Promise.all([service.courses(userId), service.upcoming(userId, days)]));
    const work = items.filter((i) => i.kind !== 'event' && !i.submitted);
    const ranked = [...work].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    const hours = work.reduce((sum, i) => sum + (i.estimate_hours ?? 0), 0);
    return {
      window_days: days,
      // This term's classes only; organization pages and old terms add noise.
      courses: (courses.some((c) => c.current) ? courses.filter((c) => c.current) : courses).map((c) => ({
        id: c.id,
        name: c.name,
        grade: c.current_grade,
        score: c.current_score,
      })),
      pending_count: work.length,
      estimated_hours_total: hours,
      top: ranked.slice(0, 10).map((i) => ({
        course: i.course_name,
        title: i.title,
        ...when(i.due_at, ctx),
        points: i.points,
        estimate_hours: i.estimate_hours,
        priority: i.priority,
        why: i.priority_label,
        missing: i.missing,
        url: i.html_url,
      })),
      events: items.filter((i) => i.kind === 'event').map((i) => ({ course: i.course_name, title: i.title, ...when(i.due_at, ctx) })),
      now_local: when(ctx.clock.now().toISOString(), ctx).due_local,
      submitted_recently: items.filter((i) => i.submitted).length,
    };
  },
});

export const canvasFiles = defineTool<{ course_id: number }>({
  name: 'canvas_files',
  description:
    "Files of a course (slides, readings, the textbook PDF...) with their size. Download what you need with canvas_download. " +
    'An empty list often means the material is in pages: try canvas_save_pages.',
  parameters: { type: 'object', properties: { course_id: courseId }, required: ['course_id'] },
  sideEffect: 'none',
  parallelSafe: true,
  async run(args, ctx) {
    const { service, userId } = canvasOf(ctx);
    return call(() => service.courseFiles(userId, Number(args.course_id)));
  },
});

export const canvasDownload = defineTool<{ file_ids: number[]; course_id?: number; folder?: string }>({
  name: 'canvas_download',
  timeoutMs: 10 * 60_000,
  description:
    "Download course files from Canvas into the user's files. With course_id they go to that course's Canvas/ folder " +
    '(kept for later in the course; a new download replaces the old copy). Without it, to TEMP/canvas/ (deleted after ' +
    '24 h): use that for something you only need to read once. Then read them with files_read (PDF, Word and PowerPoint ' +
    'come back as text by page). For a big course, build a RAG with rag_add instead. Max 150 MB per file.',
  parameters: {
    type: 'object',
    properties: {
      file_ids: {
        type: 'array',
        items: { type: 'integer' },
        description: "File ids from canvas_find, canvas_modules, canvas_files, an assignment's or page's links, or a submission's attachments (max 20)",
      },
      course_id: { ...courseId, description: "The files' course: they go to its Canvas/ folder (recommended)" },
      folder: { type: 'string', description: 'Another destination folder (overrides course_id); default "TEMP/canvas"' },
    },
    required: ['file_ids'],
  },
  sideEffect: 'none',
  mainAgentOnly: true,
  async run(args, ctx) {
    const { service, userId, workspace, spaces } = canvasOf(ctx);
    const ids = (Array.isArray(args.file_ids) ? args.file_ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
    if (ids.length === 0 || ids.length > 20) throw new Error('Give between 1 and 20 file ids');
    const fallback = args.course_id ? `${await call(() => spaces.folderFor(userId, Number(args.course_id)))}/Canvas` : 'TEMP/canvas';
    const folder = String(args.folder ?? fallback).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') || fallback;
    const results: { file_id: number; path?: string; size_mb?: number; error?: string }[] = [];
    for (const id of ids) {
      if (ctx.signal.aborted) break;
      try {
        const { path, bytes } = await call(() => service.downloadFile(userId, id, folder, workspace));
        results.push({ file_id: id, path, size_mb: Math.round((bytes / 1048576) * 100) / 100 });
      } catch (err) {
        results.push({ file_id: id, error: (err as Error).message });
      }
    }
    return results;
  },
});

export const canvasSavePages = defineTool<{ course_id: number; folder?: string; max?: number }>({
  name: 'canvas_save_pages',
  timeoutMs: 5 * 60_000,
  description:
    "Save a course's Canvas pages (lessons, notes, syllabus pages) as text files in the user's files, by default " +
    'TEMP/canvas-pages/<course_id>/ (deleted after 24 h). Many courses keep their material in pages instead of files: ' +
    'use this when canvas_files is empty or to add page content to a RAG with rag_add. Also returns linked_file_ids: ' +
    'files those pages link to, which canvas_download can fetch.',
  parameters: {
    type: 'object',
    properties: {
      course_id: courseId,
      folder: { type: 'string', description: 'Destination folder, default "TEMP/canvas-pages/<course_id>"' },
      max: { type: 'integer', description: 'Max pages to save, 1-100 (default 60)' },
    },
    required: ['course_id'],
  },
  sideEffect: 'none',
  mainAgentOnly: true,
  async run(args, ctx) {
    const { service, userId, workspace } = canvasOf(ctx);
    const id = Number(args.course_id);
    const folder = String(args.folder ?? `TEMP/canvas-pages/${id}`).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') || `TEMP/canvas-pages/${id}`;
    const max = Math.min(100, Math.max(1, Number(args.max) || 60));
    return call(() => service.savePages(userId, id, folder, workspace, max));
  },
});


export const canvasFind = defineTool<{ query: string; course_id?: number }>({
  name: 'canvas_find',
  description:
    'Find course material by name, even half-remembered ("the homework packet", "ch 7 slides", "H7", "the essay rubric"): ' +
    "searches this term's courses (or one) across module items, files, pages, assignments and quizzes, best match first, " +
    'with the module each sits in and what opens it (file_id for canvas_download, page_url for canvas_page, assignment_id for ' +
    'canvas_assignment). Use it whenever the student or an assignment mentions material you do not have yet; try other ' +
    'wordings (the chapter number, the topic, a shorter name) before saying it is not there.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Words of the name, e.g. "chapter 7 homework packet"' },
      course_id: { ...courseId, description: "Only this course (optional; default: all of this term's courses)" },
    },
    required: ['query'],
  },
  sideEffect: 'none',
  untrusted: true,
  parallelSafe: true,
  async run(args, ctx) {
    const { service, userId } = canvasOf(ctx);
    const query = String(args.query ?? '').trim().slice(0, 200);
    if (!query) throw new Error('Give the words to search for');
    const found = await call(() => service.find(userId, query, args.course_id ? Number(args.course_id) : undefined));
    return found.results.length
      ? found
      : { ...found, tip: 'Nothing matched. Try fewer or other words (a chapter number, the topic), or browse canvas_modules.' };
  },
});

export const canvasPage = defineTool<{ course_id: number; page_url: string }>({
  name: 'canvas_page',
  description:
    'Read one Canvas page (a lesson, the syllabus, a "Files for the Semester" list) as text, with `links`: each linked file ' +
    '(file_id and its link text, so open only the one you need), the pages and the ' +
    "assignment_ids it points to. Page urls come from canvas_find, canvas_modules or another page's links.",
  parameters: {
    type: 'object',
    properties: { course_id: courseId, page_url: { type: 'string', description: 'The page url slug, e.g. "week-7-notes"' } },
    required: ['course_id', 'page_url'],
  },
  sideEffect: 'none',
  untrusted: true,
  parallelSafe: true,
  async run(args, ctx) {
    const { service, userId } = canvasOf(ctx);
    return call(() => service.page(userId, Number(args.course_id), String(args.page_url)));
  },
});

export const canvasSubmissions = defineTool<{ course_id: number; assignment_id?: number }>({
  name: 'canvas_submissions',
  description:
    "The student's past work in a course. Without assignment_id: every submission with when it was turned in, the score and " +
    'grade, late/missing. With assignment_id: that submission in full: the text or files turned in (attachments with file_id ' +
    "for canvas_download), the grade, the teacher's comments and the rubric marks. Use it to review feedback, see how past " +
    'work was graded, or build on what the student already wrote.',
  parameters: {
    type: 'object',
    properties: { course_id: courseId, assignment_id: { type: 'integer', description: 'One assignment (optional)' } },
    required: ['course_id'],
  },
  sideEffect: 'none',
  untrusted: true,
  parallelSafe: true,
  async run(args, ctx) {
    const { service, userId } = canvasOf(ctx);
    const course = Number(args.course_id);
    if (args.assignment_id) return call(() => service.submission(userId, course, Number(args.assignment_id)));
    const list = await call(() => service.submissions(userId, course));
    return list.map((s) => ({ ...s, ...when(s.due_at, ctx) }));
  },
});

export const CANVAS_TOOLS: Tool[] = [
  canvasCourses,
  canvasUpcoming,
  canvasCourse,
  canvasAssignment,
  canvasAnnouncements,
  canvasModules,
  canvasFind,
  canvasPage,
  canvasSubmissions,
  canvasBriefing,
  canvasFiles,
  canvasDownload,
  canvasSavePages,
];
