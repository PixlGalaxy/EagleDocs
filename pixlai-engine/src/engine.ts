import type {
  BrowserPolicy,
  BrowserPort,
  Clock,
  EmbeddingPort,
  FetchPort,
  Logger,
  MemoryStore,
  RunStore,
  SandboxPort,
  ScheduleStore,
  SearchPort,
  SharedRagSource,
  SkillStore,
  TextExtractor,
  WorkspacePort,
} from './ports.js';
import { BROWSER_TOOLS } from './browser/tools.js';
import { CODE_TOOLS } from './tools/code.js';
import { webDownload, webFetch, webSearch } from './web/tools.js';
import { agentDelegate, taskBrief, toReport, type DelegateReport, type DelegateTask } from './agent/delegate.js';
import { runLoop, subagentTools } from './agent/loop.js';
import { CRON_TOOLS, SCHEDULED_RUN_NOTE } from './cron/tools.js';
import { BUILTIN_TOOLS } from './tools/builtin.js';
import { CORE_TOOLS } from './tools/core.js';
import { FILES_TOOLS } from './tools/files.js';
import { RAG_TOOLS } from './rag/tools.js';
import { ToolRegistry, type RunKind, type Tool } from './tools/tool.js';
import { DEFAULT_LIMITS, type ChatMessage, type EventSink, type Limits, type ResolvedModel, type RunResult, type UserProfile } from './types.js';

export interface EngineOptions {
  stores: { runs: RunStore; memory: MemoryStore; skills: SkillStore; schedules: ScheduleStore };
  /** The users' files. Enables the files pack (and, with `embeddings`, the rag pack). */
  workspace?: WorkspacePort;
  /** Documents to text for files_read and rag_add (PDF, DOCX...). Plain text works without it. */
  extractor?: TextExtractor;
  /** Enables the rag pack (with `workspace`). */
  embeddings?: EmbeddingPort;
  /** Read-only RAGs shared with users (e.g. built by an instructor). */
  sharedRags?: SharedRagSource;
  /** Code execution in a per-user sandbox. Enables the code pack (`code_run`). */
  sandbox?: SandboxPort;
  /** Web search. Enables `web_search`. */
  search?: SearchPort;
  /** Downloads public URLs. Enables `web_fetch` (and, with a workspace, `web_download`). */
  fetcher?: FetchPort;
  /** A real browser per user. Enables the browser pack. */
  browser?: BrowserPort;
  /**
   * Which browser actions run freely, need approval or are blocked, per page.
   * Without it, every click, typing and key press asks the user.
   */
  browserPolicy?: BrowserPolicy;
  /** Who the agent is and how it behaves. The engine adds the user, memory, skills and rules after it. */
  basePrompt: string;
  /** The host's own tools (its APIs, files...). Built-in memory, skills, cron, time and delegation tools are added. */
  tools?: Tool[];
  /** Built-in tools to leave out, by name. */
  disableBuiltins?: string[];
  limits?: Partial<Limits>;
  logger?: Logger;
  clock?: Clock;
}

export interface RunOptions {
  /** The host's id for this run; steers and approvals are keyed by it. */
  runId: string;
  model: ResolvedModel;
  /** Conversation so far, oldest first, ending with the message to answer. */
  history: ChatMessage[];
  sink: EventSink;
  signal?: AbortSignal;
  /** `scheduled` runs get the scheduled-task note and cannot manage schedules. */
  kind?: Exclude<RunKind, 'subagent'>;
  /** Narrows the tools for this run (e.g. ones the user turned off). */
  toolFilter?: (tool: Tool) => boolean;
  /**
   * Lets agent_delegate run helpers in the background: the host stores the tasks,
   * runs them later with `runSubagents`, and hands the reports back in a new turn
   * (see `backgroundReportMessage`). Without it, delegation always waits.
   */
  startBackground?: (tasks: DelegateTask[]) => Promise<void>;
}

export interface SubagentRunOptions {
  /** Tags the helpers' events (`subagent` events with this as `parent_call_id`). */
  runId: string;
  model: ResolvedModel;
  tasks: DelegateTask[];
  sink: EventSink;
  signal?: AbortSignal;
  toolFilter?: (tool: Tool) => boolean;
}

/** One user's agent: isolated memory, skills, schedules and limits. Cheap to create per request. */
export interface UserAgent {
  readonly user: UserProfile;
  readonly limits: Limits;
  tools(): Tool[];
  run(options: RunOptions): Promise<RunResult>;
  /** Runs helper agents in parallel outside a chat run (background delegation). */
  runSubagents(options: SubagentRunOptions): Promise<{ reports: DelegateReport[]; usage: { inputTokens: number; outputTokens: number } }>;
}

export interface Engine {
  forUser(user: UserProfile, options?: { limits?: Partial<Limits>; host?: Record<string, unknown> }): UserAgent;
}

const consoleLogger: Logger = {
  info: (m) => console.log(`[pixlai-engine] ${m}`),
  warn: (m) => console.warn(`[pixlai-engine] ${m}`),
  error: (m, d) => console.error(`[pixlai-engine] ${m}`, d ?? ''),
};

/**
 * Create once per process. The engine holds no per-user state: every run reads
 * and writes through the stores, so many processes can serve the same users.
 */
export function createEngine(options: EngineOptions): Engine {
  const disabled = new Set(options.disableBuiltins ?? []);
  const packs = [
    ...BUILTIN_TOOLS,
    ...CORE_TOOLS,
    ...CRON_TOOLS,
    agentDelegate,
    // Packs that need host services only appear when the host provides them.
    ...(options.workspace ? FILES_TOOLS : []),
    ...(options.workspace && options.embeddings ? RAG_TOOLS : []),
    ...(options.sandbox ? CODE_TOOLS : []),
    ...(options.search ? [webSearch] : []),
    ...(options.fetcher ? [webFetch] : []),
    ...(options.fetcher && options.workspace ? [webDownload] : []),
    ...(options.browser ? BROWSER_TOOLS : []),
  ];
  const builtins = packs.filter((t) => !disabled.has(t.name));
  const registry = new ToolRegistry([...builtins, ...(options.tools ?? [])]);
  const services = {
    ...options.stores,
    clock: options.clock ?? { now: () => new Date() },
    logger: options.logger ?? consoleLogger,
    workspace: options.workspace,
    extractor: options.extractor,
    embeddings: options.embeddings,
    sharedRags: options.sharedRags,
    sandbox: options.sandbox,
    search: options.search,
    fetcher: options.fetcher,
    browser: options.browser,
    browserPolicy: options.browserPolicy,
  };
  const engineLimits: Limits = { ...DEFAULT_LIMITS, ...options.limits };

  return {
    forUser(user, userOptions) {
      const limits: Limits = { ...engineLimits, ...userOptions?.limits };
      const available = (kind: RunKind) =>
        registry.filter((tool) => {
          if (tool.name === 'agent_delegate' && limits.maxSubagentDepth === 0) return false;
          if (kind === 'scheduled' && tool.name.startsWith('cron_')) return false;
          return true;
        });

      return {
        user,
        limits,
        tools: () => available('chat').list(),
        run(run) {
          const kind = run.kind ?? 'chat';
          let tools = available(kind);
          if (run.toolFilter) tools = tools.filter(run.toolFilter);
          return runLoop({
            services,
            basePrompt: options.basePrompt,
            user,
            limits,
            host: userOptions?.host ?? {},
            tools,
            runId: run.runId,
            kind,
            depth: 0,
            model: run.model,
            history: run.history,
            sink: run.sink,
            signal: run.signal ?? new AbortController().signal,
            extraInstructions: kind === 'scheduled' ? SCHEDULED_RUN_NOTE : undefined,
            startBackground: run.startBackground,
          });
        },
        async runSubagents(run) {
          let tools = subagentTools(available('chat'), 1, limits);
          if (run.toolFilter) tools = tools.filter(run.toolFilter);
          const budget = { inputTokens: 0, outputTokens: 0 };
          const signal = run.signal ?? new AbortController().signal;
          const reports = await Promise.all(
            run.tasks.slice(0, limits.maxParallelSubagents).map(async (task, index) => {
              const goal = String(task.goal ?? '').trim();
              const child = await runLoop({
                services,
                basePrompt: options.basePrompt,
                user,
                limits,
                host: userOptions?.host ?? {},
                tools,
                runId: run.runId,
                kind: 'subagent',
                depth: 1,
                model: run.model,
                history: [{ role: 'user', content: taskBrief(task) }],
                sink: { emit: (event) => run.sink.emit({ type: 'subagent', parent_call_id: run.runId, index, task: goal.slice(0, 200), event }) },
                signal,
                extraInstructions: 'You are a helper at depth 1, working in the background.',
                budget,
              });
              return toReport(goal, {
                status: child.status === 'done' ? 'done' : child.status === 'cancelled' ? 'cancelled' : 'failed',
                summary: child.status === 'done' ? child.content : `The helper ${child.status}: ${child.error ?? 'no answer'}`,
              });
            }),
          );
          return { reports, usage: budget };
        },
      };
    },
  };
}
