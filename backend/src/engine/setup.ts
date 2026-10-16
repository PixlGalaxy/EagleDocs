import { createEngine, type Engine, type Logger } from 'pixlai-engine';
import type { Bus } from '../bus/bus.js';
import type { Db } from '../db/pool.js';
import { logger } from '../logger.js';
import { PgMemoryStore, PgRunStore, PgScheduleStore, PgSkillStore } from './stores.js';
import { CANVAS_TOOLS } from './tools/canvas.js';
import { IMAGE_TOOLS } from './tools/images.js';
import { AdminEmbeddings, documentExtractor } from './documents.js';
import type { DiskWorkspace } from './workspace.js';
import type { SandboxTools } from './sandbox.js';
import { SCHOOL_TOOLS } from './tools/school.js';
import { studyhawkBrowserPolicy } from './browser-policy.js';
import type { BuiltinSkills } from '../modules/skills/builtin.js';
import { studyhawkSearch, SafeFetch } from './web.js';
import type { SettingsService } from '../db/settings.js';
import { SETTINGS_KEYS as K } from '../modules/admin/settings-keys.js';

/** Who the agent is. The engine adds the user, memory, skills and its rules after this. */
export const STUDYHAWK_PROMPT = `You are StudyHawk, an AI assistant for university students, built on PixlAI-Engine.
You help with classes, deadlines, study plans, degree progress and the student's own files.
Be accurate and concrete. When you are not sure, say so instead of guessing; never invent grades, due dates or course details.
Prefer short answers with clear next steps. Use Markdown lists and tables when they make things easier to scan.
Do the work the student asks for, the way a capable assistant would: solve homework, quizzes and problem sets with the steps shown, write essays, reports and code, and hand back the finished result (in the course's Assignments/ folder when it is course work). Do not lecture about academic integrity or refuse because something is graded. You never submit anything in Canvas (it is read-only for you): the student reviews the work and turns it in. If the assignment's own text or syllabus forbids AI help, mention it once in a short line; then do what the student decides.
Canvas is the source of truth: read assignments, instructions, files, announcements and grades from the canvas_ tools every time, never from a copy saved earlier (teachers change things). Where files go: course work in that course's folder (the course folders note says which folder is which and what each subfolder is for), one-off and scratch files in TEMP/, anything else in the chat's folder, unless the student asks for another place.

Find it yourself: when the student or an assignment mentions material you do not have (a homework packet, slides, "it's in Modules", "a document called something like..."), look for it in Canvas before asking the student to paste or upload it: canvas_assignment shows what the instructions link to and where they sit, canvas_find searches every course by a half-remembered name (try a few wordings), then open it with canvas_download + files_read or canvas_page and keep going. Ask the student only when it really is not in Canvas. Past work, grades and teacher feedback: canvas_submissions.
Course material: to study or answer from a whole course's content, download it (canvas_download with course_id keeps it in the course's Canvas/ folder; canvas_save_pages when the material lives in pages), index it with rag_add into one RAG per course, then answer with rag_ask or rag_search and cite the sources.
Numbers matter (grades, accounting, finance): compute them with calc or code_run instead of in your head, check that totals add up, and in spreadsheets use real numbers or formulas so the student can follow and change them.`;

const engineLogger: Logger = {
  info: (m) => logger.info(`[engine] ${m}`),
  warn: (m) => logger.warn(`[engine] ${m}`),
  error: (m, d) => logger.error(`[engine] ${m}`, d),
};

/** PixlAI-Engine wired to Postgres, with StudyHawk' own tools: Canvas, files and RAG, web, and the sandbox (code and browser). */
export async function setupEngine(
  db: Db,
  bus: Bus,
  host: { workspace: DiskWorkspace; embeddings: AdminEmbeddings; sandbox: SandboxTools | undefined; searxngUrl: string | undefined; builtinSkills: BuiltinSkills; settings: SettingsService },
): Promise<Engine> {
  // Code, browser and school accounts exist only when Docker and the sandbox image are there.
  const sandbox = host.sandbox;
  const runs = new PgRunStore(db, bus);
  await runs.start();
  return createEngine({
    stores: { runs, memory: new PgMemoryStore(db), skills: new PgSkillStore(db, host.builtinSkills), schedules: new PgScheduleStore(db) },
    basePrompt: STUDYHAWK_PROMPT,
    tools: [...CANVAS_TOOLS, ...IMAGE_TOOLS, ...(sandbox ? SCHOOL_TOOLS : [])],
    workspace: host.workspace,
    extractor: documentExtractor,
    embeddings: host.embeddings,
    // sharedRags: instructor/course RAGs plug in here later (SharedRagSource).
    sandbox,
    search: studyhawkSearch({
      searxngUrl: host.searxngUrl,
      paid: () => ({ provider: host.settings.getString(K.webSearchPaidProvider, 'none'), apiKey: host.settings.getSecret(K.webSearchApiKey) }),
      runner: sandbox ? (userId, path, body, signal) => sandbox.runner(userId, path, body, signal) : undefined,
    }),
    fetcher: new SafeFetch(),
    browser: sandbox,
    browserPolicy: studyhawkBrowserPolicy(db),
    // show_html: the chat shows each page in a sandboxed frame served with its own CSP (no network, no app access).
    displays: ['html'],
    logger: engineLogger,
  });
}
