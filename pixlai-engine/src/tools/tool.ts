import type {
  BrowserPolicy,
  BrowserPort,
  Clock,
  EmbeddingPort,
  FetchPort,
  Logger,
  MemoryStore,
  SandboxPort,
  ScheduleStore,
  SearchPort,
  SharedRagSource,
  SkillStore,
  TextExtractor,
  WorkspacePort,
} from '../ports.js';
import type { EngineEvent, JsonSchema, Limits, UserProfile, Display, UserQuestion } from '../types.js';

/** What a tool sees while it runs. */
export interface ToolContext {
  user: UserProfile;
  runId: string;
  /** Aborted when the run is cancelled or the tool times out. */
  signal: AbortSignal;
  /** 0 for the main agent, 1+ inside subagents. */
  depth: number;
  limits: Limits;
  emit(event: EngineEvent): void;
  memory: MemoryStore;
  skills: SkillStore;
  schedules: ScheduleStore;
  clock: Clock;
  logger: Logger;
  /** The user's files, when the host provides them (files and rag packs). */
  workspace?: WorkspacePort;
  /** Documents to text (PDF, DOCX...), when the host provides it. */
  extractor?: TextExtractor;
  /** Embeddings for RAG, when the host provides them. */
  embeddings?: EmbeddingPort;
  /** Read-only RAGs other people built for this user. */
  sharedRags?: SharedRagSource;
  /** Code execution in the user's sandbox (code pack). */
  sandbox?: SandboxPort;
  /** Web search and page downloads (web pack). */
  search?: SearchPort;
  fetcher?: FetchPort;
  /** A real browser per user (browser pack) and the rule for acting on pages. */
  browser?: BrowserPort;
  browserPolicy?: BrowserPolicy;
  /**
   * One extra call to the run's own model, outside the conversation (no tools,
   * no history): for summarizing or answering from retrieved text without
   * filling the main context. Token use counts toward the run.
   */
  complete(system: string, prompt: string): Promise<string>;
  /** Host data for its own tools (e.g. an API client for this user). */
  host: Record<string, unknown>;
  /** Id of the tool call being executed. */
  callId: string;
  /** What kind of run this is: scheduled runs may not create schedules, subagents get fewer tools. */
  runKind: RunKind;
  /**
   * Ends the run after the current tool batch with `question` as the answer,
   * so the user can reply (ask_user). Not available to subagents.
   */
  askUser?: (question: string, questions?: UserQuestion[]) => void;
  /** Shows something in the conversation (show_html). Not available to subagents. */
  display?: (item: Display) => void;
  /** Starts a subagent (only set when delegation is allowed at this depth). */
  /** `model`: a ref or tag from the host's helper models; the parent's model when absent or unknown. */
  spawnSubagent?: (goal: string, index: number, model?: string) => Promise<SubagentOutcome>;
  /**
   * Hands tasks to the host to run in the background (agent_delegate with
   * `background`). Only for the main agent, and only when the host supports it.
   */
  startBackground?: (tasks: { goal: string; context?: string; model?: string }[]) => Promise<void>;
  /** Offers groups of tools from the next model call on (tools_load). Only in runs with lazy tool groups. */
  loadToolGroups?: (groups: string[]) => { loaded: { group: string; tools: string[] }[]; unknown: string[] };
}

export type RunKind = 'chat' | 'scheduled' | 'subagent';

/** What a gate can look at: who runs, which kind of run, and the host's services. */
export type GateContext = Pick<ToolContext, 'user' | 'runKind' | 'host' | 'browser' | 'browserPolicy' | 'workspace'>;

/** What an approval card shows: one line, plus the fields worth reading before approving. */
export interface ApprovalText {
  summary: string;
  details?: Record<string, string>;
}

export interface SubagentOutcome {
  status: 'done' | 'failed' | 'cancelled';
  summary: string;
  /** Label of the model the helper ran on. */
  model?: string;
}

export interface Tool<Args extends Record<string, unknown> = Record<string, unknown>> {
  /** Letters, digits, `_` and `-` only: what every provider accepts. Group with a prefix, e.g. `crm_contacts`. */
  name: string;
  description: string;
  parameters: JsonSchema;
  /**
   * `external` tools act outside the user's own workspace and cannot be undone
   * (sending, submitting, deleting remote data): each call waits for the
   * user's approval. Everything else runs freely.
   */
  sideEffect: 'none' | 'external';
  /**
   * Results come from somewhere a third party controls (web pages, emails,
   * third-party documents): they are wrapped so the model treats them as data.
   */
  untrusted?: boolean;
  /** Never offered to subagents (e.g. scheduling, memory writes). */
  mainAgentOnly?: boolean;
  /**
   * With `EngineOptions.lazyToolGroups`, tools of a group are offered only after
   * the agent loads it with tools_load (or the conversation already used one).
   * Tools without a group are always offered.
   */
  group?: string;
  /** Read-only and independent of other calls: may run at the same time as neighbouring safe calls. */
  parallelSafe?: boolean;
  /** Overrides limits.toolTimeoutMs for tools that legitimately take minutes (downloads, indexing). */
  timeoutMs?: number;
  /**
   * Per-call decision, for tools whose risk depends on the arguments or the
   * current state (e.g. clicking on one site is fine, on another it needs the
   * user): `run`, `approve` (wait for the user like an external tool) or
   * `{ refuse }` (fails with that message). Runs before `sideEffect` is checked.
   */
  gate?(args: Args, ctx: GateContext): Promise<'run' | 'approve' | { refuse: string }>;
  /** For approvals: one line saying what will happen, plus the fields worth showing. */
  /**
   * May be async and read host data (e.g. show the saved email the approval would send instead of its id).
   * Falls back to the tool name if it throws.
   */
  describe?(args: Args, ctx: GateContext): ApprovalText | Promise<ApprovalText>;
  /**
   * The arguments as tool cards (events, saved answers) show them. Default: all of them, long texts clipped.
   * Leave out what is shown another way or too big to send around (show_html's page).
   */
  view?(args: Args): Record<string, unknown>;
  run(args: Args, ctx: ToolContext): Promise<unknown>;
}

/** Helper that keeps the args type next to the schema. */
export function defineTool<Args extends Record<string, unknown>>(tool: Tool<Args>): Tool {
  return tool as unknown as Tool;
}

const NAME = /^[a-zA-Z0-9_-]{1,64}$/;

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  constructor(tools: Tool[] = []) {
    for (const tool of tools) this.add(tool);
  }

  add(tool: Tool): void {
    if (!NAME.test(tool.name)) throw new Error(`Invalid tool name "${tool.name}"`);
    if (this.tools.has(tool.name)) throw new Error(`Tool "${tool.name}" is registered twice`);
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): Tool[] {
    return [...this.tools.values()];
  }

  /** A new registry with only the tools `keep` accepts. */
  filter(keep: (tool: Tool) => boolean): ToolRegistry {
    return new ToolRegistry(this.list().filter(keep));
  }
}
