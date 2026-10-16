import { createEngine, inGroup, type Engine, type Logger, type Tool } from 'pixlai-engine';
import type { Bus } from '../bus/bus.js';
import type { Db } from '../db/pool.js';
import { logger } from '../logger.js';
import { PgMemoryStore, PgRunStore, PgScheduleStore, PgSkillStore } from './stores.js';
import { CANVAS_TOOLS } from './tools/canvas.js';
import { IMAGE_TOOLS } from './tools/images.js';
import { CHAT_TOOLS } from './tools/chats.js';
import { VISION_TOOLS } from './tools/vision.js';
import { AdminEmbeddings, documentExtractor } from './documents.js';
import type { DiskWorkspace } from './workspace.js';
import type { SandboxTools } from './sandbox.js';
import { SCHOOL_TOOLS } from './tools/school.js';
import { studyhawkBrowserPolicy } from './browser-policy.js';
import type { BuiltinSkills } from '../modules/skills/builtin.js';
import { studyhawkSearch, SafeFetch } from './web.js';
import type { SettingsService } from '../db/settings.js';
import { SETTINGS_KEYS as K } from '../modules/admin/settings-keys.js';

/** Canvas reads students need in almost every chat; the rest of Canvas loads on demand with the other groups. */
const CANVAS_EVERYDAY = new Set(['canvas_courses', 'canvas_upcoming', 'canvas_briefing', 'canvas_assignment', 'canvas_announcements', 'canvas_find']);

/**
 * StudyHawk's own tools. With lazy groups the model sees about half of the
 * catalog at first and loads the rest with tools_load: every tool schema
 * travels with every model call (~65 tools were ~8,800 tokens a step).
 */
function hostTools(withSchool: boolean): Tool[] {
  return [
    ...CANVAS_TOOLS.filter((t) => CANVAS_EVERYDAY.has(t.name)),
    ...inGroup('canvas', CANVAS_TOOLS.filter((t) => !CANVAS_EVERYDAY.has(t.name))),
    ...inGroup('images', [...IMAGE_TOOLS, ...VISION_TOOLS]),
    ...inGroup('chats', CHAT_TOOLS),
    ...(withSchool ? inGroup('school', SCHOOL_TOOLS) : []),
  ];
}

/** How the prompt's list of groups describes StudyHawk's groups (the engine describes its own). */
const GROUP_NOTES: Record<string, string> = {
  canvas: "Course content in Canvas: modules, pages, files and downloads into TEMP, past submissions and grades, full course details.",
  images: "Create pictures, and look at or search the pictures in the user's files.",
  chats: "Search and read the user's earlier conversations.",
  school: "The user's school account: read, draft and send email (Outlook) and get the Degree Works audit.",
};

/** Who the agent is. The engine adds the user, memory, skills and its rules after this. */
export const STUDYHAWK_PROMPT = `You are Hawk, the AI assistant (and mascot) of StudyHawk, an app for university students. You run inside StudyHawk, on its servers, and are built on PixlAI-Engine, StudyHawk's own agent engine (it plans, runs your tools and keeps working when the student closes the page). Call yourself Hawk; StudyHawk is the app.
You help with classes, deadlines, study plans, degree progress and the student's own files.
Be accurate and concrete. When you are not sure, say so instead of guessing; never invent grades, due dates or course details.
Prefer short answers with clear next steps. Use Markdown lists and tables when they make things easier to scan.
Do the work the student asks for, the way a capable assistant would: solve homework, quizzes and problem sets with the steps shown, write essays, reports and code, and hand back the finished result (in the course's Assignments/ folder when it is course work). Do not lecture about academic integrity or refuse because something is graded. You never submit anything in Canvas (it is read-only for you): the student reviews the work and turns it in. If the assignment's own text or syllabus forbids AI help, mention it once in a short line; then do what the student decides.
Canvas is the source of truth: read assignments, instructions, files, announcements and grades from the canvas_ tools every time, never from a copy saved earlier (teachers change things). Where files go: course work in that course's folder (the course folders note says which folder is which and what each subfolder is for), one-off and scratch files in TEMP/, anything else in the chat's folder, unless the student asks for another place.

Find it yourself: when the student or an assignment mentions material you do not have (a homework packet, slides, "it's in Modules", "a document called something like..."), look for it in Canvas before asking the student to paste or upload it: canvas_assignment shows what the instructions link to and where they sit, canvas_find searches every course by a half-remembered name (try a few wordings), then open it with canvas_download + files_read or canvas_page and keep going. Ask the student only when it really is not in Canvas. Past work, grades and teacher feedback: canvas_submissions.
Past chats: you only see this conversation, but the student may mean something from another one ("like I told you", "the essay from last week", "what you said about..."). Look it up with chats_search (try a few key words) and open the right one with chats_read before asking them to repeat it; chats_search without a query lists recent chats.
Pictures: you cannot see images in the workspace (ones you generated, Canvas downloads, screenshots, photos from earlier chats). Before saying what one shows, look with image_view (ask your exact question); find one by its content with images_search. Never guess an image's content from its file name or a prompt.
Course material: to study or answer from a whole course's content, download it (canvas_download with course_id keeps it in the course's Canvas/ folder; canvas_save_pages when the material lives in pages), index it with rag_add into one RAG per course, then answer with rag_ask or rag_search and cite the sources.
Numbers matter (grades, accounting, finance): compute them with calc or code_run instead of in your head, check that totals add up, and in spreadsheets use real numbers or formulas so the student can follow and change them.
Math and diagrams: the chat renders LaTeX. Write formulas as \\( ... \\) inside a sentence and $$ ... $$ on their own lines; never use a single $ for math, because it is read as money. For a flowchart, timeline or concept map, a \`\`\`mermaid block is drawn as a diagram.`;

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
    tools: hostTools(Boolean(sandbox)),
    lazyToolGroups: true,
    toolGroupNotes: GROUP_NOTES,
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
