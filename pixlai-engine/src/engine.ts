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
import { helperModel, runLoop, runToolOnce, subagentTools } from './agent/loop.js';
import { CRON_TOOLS, SCHEDULED_RUN_NOTE } from './cron/tools.js';
import { BUILTIN_TOOLS } from './tools/builtin.js';
import { CORE_TOOLS } from './tools/core.js';
import { DISPLAY_TOOLS } from './tools/display.js';
import { FILES_TOOLS } from './tools/files.js';
import { ENGINE_GROUP_NOTES, inGroup, toolsLoad } from './tools/groups.js';
import { RAG_TOOLS } from './rag/tools.js';
import { ToolRegistry, type RunKind, type Tool } from './tools/tool.js';
import {
  DEFAULT_LIMITS,
  type ChatMessage,
  type EngineEvent,
  type EventSink,
  type HelperModels,
  type ReasoningLevel,
  type Limits,
  type ResolvedModel,
  type RunResult,
  type UserProfile,
} from './types.js';

export interface EngineOptions {
  /**
   * What the host can show in the conversation besides text. `'html'` enables show_html: the host must render
   * `RunResult.displays` isolated from the app (a sandboxed frame without network).
   */
  displays?: 'html'[];
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
  /**
   * Offers grouped tools on demand: the model sees the tools without a `group`
   * and tools_load, plus a list of the groups it can load. Cuts the tokens every
   * step spends on tool schemas, which matters with many tools and small models.
   * Engine packs come grouped (schedules, rag, code, web, browser, display); give
   * the host's tools a `group` and describe it in `toolGroupNotes`.
   */
  lazyToolGroups?: boolean;
  /** One line per host group for the prompt's list of groups, e.g. `{ email: 'Read and send school email.' }`. */
  toolGroupNotes?: Record<string, string>;
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
  /** How hard the model thinks (reasoning models). Helpers get the same level. */
  reasoning?: ReasoningLevel;
  /**
   * The host's notes for this run, added to the system prompt and inherited by
   * helpers: context only the host knows (e.g. "save this chat's files in Chats/Essay").
   */
  notes?: string;
  /**
   * Lets agent_delegate run helpers in the background: the host stores the tasks,
   * runs them later with `runSubagents`, and hands the reports back in a new turn
   * (see `backgroundReportMessage`). Without it, delegation always waits.
   */
  startBackground?: (tasks: DelegateTask[]) => Promise<void>;
  /**
   * Models the agent may give its helpers (agent_delegate `model`): listed in its
   * prompt with guidance to match the model to the work. Without it, helpers use the run's model.
   */
  helperModels?: HelperModels;
  /** With lazy tool groups: groups offered from the start (e.g. the user turned on "browser" for this chat). */
  toolGroups?: string[];
}

export interface SubagentRunOptions {
  /** Tags the helpers' events (`subagent` events with this as `parent_call_id`). */
  runId: string;
  model: ResolvedModel;
  tasks: DelegateTask[];
  sink: EventSink;
  signal?: AbortSignal;
  toolFilter?: (tool: Tool) => boolean;
  /** Resolves each task's `model`; tasks without one use `model`. */
  helperModels?: HelperModels;
  /** Same as RunOptions.notes. */
  notes?: string;
  /** Same as RunOptions.toolGroups. */
  toolGroups?: string[];
}

/** One user's agent: isolated memory, skills, schedules and limits. Cheap to create per request. */
export interface UserAgent {
  readonly user: UserProfile;
  readonly limits: Limits;
  tools(): Tool[];
  run(options: RunOptions): Promise<RunResult>;
  /**
   * Runs one tool outside a conversation, e.g. for an MCP client. Same context,
   * gates, timeout and untrusted wrapping as in a run; tools that would need an
   * approval are refused (there is no one to ask), and `complete` is unavailable.
   */
  callTool(name: string, args: Record<string, unknown>, options?: { runId?: string; signal?: AbortSignal; emit?: (event: EngineEvent) => void; toolFilter?: (tool: Tool) => boolean }): Promise<{ status: 'done' | 'error'; content: string; untrusted: boolean }>;
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
    ...inGroup('schedules', CRON_TOOLS),
    agentDelegate,
    // Packs that need host services only appear when the host provides them.
    ...(options.workspace ? FILES_TOOLS : []),
    ...(options.workspace && options.embeddings ? inGroup('rag', RAG_TOOLS) : []),
    ...(options.sandbox ? inGroup('code', CODE_TOOLS) : []),
    ...inGroup('web', [
      ...(options.search ? [webSearch] : []),
      ...(options.fetcher ? [webFetch] : []),
      ...(options.fetcher && options.workspace ? [webDownload] : []),
    ]),
    ...(options.browser ? inGroup('browser', BROWSER_TOOLS) : []),
    ...(options.displays?.includes('html') ? inGroup('display', DISPLAY_TOOLS) : []),
    ...(options.lazyToolGroups ? [toolsLoad] : []),
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
  const groupNotes = { ...ENGINE_GROUP_NOTES, ...options.toolGroupNotes };
  const lazyGroups = (active?: string[]) => (options.lazyToolGroups ? { toolGroups: { notes: groupNotes, active } } : {});

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
            helperModels: run.helperModels,
            reasoning: run.reasoning,
            notes: run.notes,
            ...lazyGroups(run.toolGroups),
          });
        },
        callTool(name, args, opts = {}) {
          let tools = available('chat');
          if (opts.toolFilter) tools = tools.filter(opts.toolFilter);
          return runToolOnce({
            services,
            user,
            limits,
            host: userOptions?.host ?? {},
            tools,
            name,
            args,
            runId: opts.runId ?? `call-${Date.now()}`,
            signal: opts.signal ?? new AbortController().signal,
            emit: opts.emit,
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
              const childModel = await helperModel(run.helperModels, task.model, run.model, services.logger);
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
                model: childModel,
                history: [{ role: 'user', content: taskBrief(task) }],
                helperModels: run.helperModels,
                sink: {
                  emit: (event) =>
                    run.sink.emit({ type: 'subagent', parent_call_id: run.runId, index, task: goal.slice(0, 200), model_label: childModel.label, event }),
                },
                signal,
                extraInstructions: 'You are a helper at depth 1, working in the background.',
                notes: run.notes,
                budget,
                ...lazyGroups(run.toolGroups),
              });
              return toReport(goal, {
                status: child.status === 'done' ? 'done' : child.status === 'cancelled' ? 'cancelled' : 'failed',
                summary: child.status === 'done' ? child.content : `The helper ${child.status}: ${child.error ?? 'no answer'}`,
                model: childModel.label,
              });
            }),
          );
          return { reports, usage: budget };
        },
      };
    },
  };
}
