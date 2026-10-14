import { createEngine, type Engine, type Logger } from 'pixlai-engine';
import type { Bus } from '../bus/bus.js';
import type { Db } from '../db/pool.js';
import { logger } from '../logger.js';
import { PgMemoryStore, PgRunStore, PgScheduleStore, PgSkillStore } from './stores.js';
import { CANVAS_TOOLS } from './tools/canvas.js';
import { AdminEmbeddings, documentExtractor } from './documents.js';
import type { DiskWorkspace } from './workspace.js';
import type { SandboxTools } from './sandbox.js';
import { SCHOOL_TOOLS } from './tools/school.js';
import { eagledocsBrowserPolicy } from './browser-policy.js';
import { SafeFetch, WebSearch } from './web.js';

/** Who the agent is. The engine adds the user, memory, skills and its rules after this. */
export const EAGLEDOCS_PROMPT = `You are EagleDocs, an AI assistant for university students, built on PixlAI-Engine.
You help with classes, deadlines, study plans, degree progress and the student's own files.
Be accurate and concrete. When you are not sure, say so instead of guessing; never invent grades, due dates or course details.
Prefer short answers with clear next steps. Use Markdown lists and tables when they make things easier to scan.
Never write or submit graded work for the student as if it were theirs: explain, guide, review and give feedback instead.
Course material: to study or answer from a course's content, bring it into TEMP (canvas_files + canvas_download, and canvas_save_pages when the material lives in pages), index it with rag_add into one RAG per course, then answer with rag_ask or rag_search and cite the sources. The RAG keeps the text, so the downloads can expire in TEMP; keep in the workspace only what the student will want later.
Numbers matter (grades, accounting, finance): compute them with calc or code_run instead of in your head, check that totals add up, and in spreadsheets use real numbers or formulas so the student can follow and change them.`;

const engineLogger: Logger = {
  info: (m) => logger.info(`[engine] ${m}`),
  warn: (m) => logger.warn(`[engine] ${m}`),
  error: (m, d) => logger.error(`[engine] ${m}`, d),
};

/** PixlAI-Engine wired to Postgres, with EagleDocs' own tools: Canvas, files and RAG, web, and the sandbox (code and browser). */
export async function setupEngine(
  db: Db,
  bus: Bus,
  host: { workspace: DiskWorkspace; embeddings: AdminEmbeddings; sandbox: SandboxTools | undefined; searxngUrl: string | undefined },
): Promise<Engine> {
  // Code, browser and school accounts exist only when Docker and the sandbox image are there.
  const sandbox = host.sandbox;
  const runs = new PgRunStore(db, bus);
  await runs.start();
  return createEngine({
    stores: { runs, memory: new PgMemoryStore(db), skills: new PgSkillStore(db), schedules: new PgScheduleStore(db) },
    basePrompt: EAGLEDOCS_PROMPT,
    tools: [...CANVAS_TOOLS, ...(sandbox ? SCHOOL_TOOLS : [])],
    workspace: host.workspace,
    extractor: documentExtractor,
    embeddings: host.embeddings,
    // sharedRags: instructor/course RAGs plug in here later (SharedRagSource).
    sandbox,
    search: new WebSearch(host.searxngUrl),
    fetcher: new SafeFetch(),
    browser: sandbox,
    browserPolicy: eagledocsBrowserPolicy(db),
    logger: engineLogger,
  });
}
