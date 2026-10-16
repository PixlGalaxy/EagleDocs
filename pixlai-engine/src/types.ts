/**
 * Core types of PixlAI-Engine. Nothing here knows about HTTP, databases or a
 * particular product: hosts plug those in through the ports in `ports.ts`.
 */

export type JsonSchema = {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  additionalProperties?: boolean | JsonSchema;
  [key: string]: unknown;
};

export interface ToolCallRequest {
  /** Provider-assigned id, echoed back in the matching tool message. */
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** Assistant turns that asked for tools. */
  toolCalls?: ToolCallRequest[];
  /** Tool results: which call they answer. */
  toolCallId?: string;
  /** Tool results: the tool's name (some providers need it). */
  name?: string;
  /** A correction the user sent while the agent was working. */
  steer?: boolean;
  /** User turns: pictures the user attached. Sent to models with `supportsVision`; others get a note instead. */
  images?: ChatImage[];
}

export interface ChatImage {
  /** e.g. "image/png", "image/jpeg", "image/webp", "image/gif". */
  mediaType: string;
  /** Base64, no data: prefix. */
  data: string;
  /** Where the user's copy lives (shown to models that cannot see it, so tools can open it). */
  name?: string;
}

// ------------------------------------------------------------------ models

export interface ToolSpec {
  name: string;
  description: string;
  parameters: JsonSchema;
}

/** How hard a reasoning model thinks before answering. Providers map it to their own setting and ignore it when unsupported. */
export type ReasoningLevel = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export interface ModelRequest {
  model: string;
  messages: ChatMessage[];
  /** Absent: the provider's default. */
  reasoning?: ReasoningLevel;
  /** Omitted when the model cannot call tools. */
  tools?: ToolSpec[];
  signal: AbortSignal;
}

export type ModelChunk =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; call: ToolCallRequest }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'done' };

/** Any LLM backend: Ollama, OpenAI-compatible, Anthropic, Codex... Implemented by the host. */
export interface ModelProvider {
  stream(request: ModelRequest): AsyncIterable<ModelChunk>;
}

/** A concrete model the host picked for this run (the host does routing, quotas and fallbacks). */
export interface ResolvedModel {
  provider: ModelProvider;
  /** Name sent to the provider, e.g. "deepseek-r1:14b". */
  model: string;
  /** Shown to the user, e.g. "Auto -> GPT-5". */
  label: string;
  /** Opaque id the host understands, e.g. "ollama:ep1:deepseek-r1:14b". */
  ref: string;
  supportsTools: boolean;
  /** Tokens. Used to decide when to compact the history. */
  contextWindow: number;
  /** Can read images in user messages. Without it, images become a note with their name. */
  supportsVision?: boolean;
}

/** A model the main agent may give a helper (agent_delegate `model`). */
export interface HelperModel {
  /** What the agent passes as `model`. */
  ref: string;
  label: string;
  /** e.g. "fast", "smart", "code": the agent can also pass a tag instead of a ref. */
  tags: string[];
}

/** The models a host offers for helpers, and how it turns a choice into a model. */
export interface HelperModels {
  list: HelperModel[];
  /** A ref from `list` or a tag. null when it is not available: the helper then uses its parent's model. */
  resolve(choice: string): Promise<ResolvedModel | null>;
}

// ------------------------------------------------------------------ events

/** `waiting_mfa`: a tool waits for the user to approve a sign-in on another device (Duo, Authenticator). Hosts emit it. */
export type RunStatus = 'running' | 'waiting_approval' | 'waiting_mfa' | 'done' | 'failed' | 'cancelled';

export interface ToolCallView {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: 'running' | 'done' | 'error' | 'waiting_approval' | 'rejected';
  result_preview?: string;
}

export interface ApprovalView {
  id: string;
  tool_name: string;
  summary: string;
  details: Record<string, string>;
}

/**
 * Everything a run reports while it works, in order. Hosts forward these to
 * the UI (e.g. a database table plus server-sent events).
 */
export type EngineEvent =
  | { type: 'status'; status: RunStatus }
  | { type: 'model'; model_ref: string; model_label: string }
  | { type: 'delta'; text: string }
  | { type: 'tool_call'; call: ToolCallView }
  | { type: 'tool_result'; call: ToolCallView }
  | { type: 'approval_required'; approval: ApprovalView }
  | { type: 'steer_applied'; id: string; content: string }
  /** A steer arrived while the model was writing: that answer was cut short and the model starts again with the correction. */
  | { type: 'interrupted' }
  /** An event from a subagent, tagged with the delegate call that started it. */
  | { type: 'subagent'; parent_call_id: string; index: number; task: string; model_label: string; event: EngineEvent }
  | { type: 'usage'; input_tokens: number; output_tokens: number }
  /** Before each model call of a top-level run: estimated prompt tokens and the model's window (compaction starts at 75%). */
  | { type: 'context'; used: number; window: number }
  | { type: 'notice'; message: string }
  /** The agent's visible plan for this task (plan_update). Each event replaces the previous plan. */
  | { type: 'plan'; title?: string; steps: PlanStep[] }
  /** Something the agent wants the user to see even if they are not watching (notify). Hosts may push it. */
  | { type: 'notify'; title: string; body: string; url?: string }
  /**
   * A tool is waiting for the user to approve a sign-in on their phone (Duo push, Microsoft Authenticator...).
   * Emitted by host tools with ctx.emit, followed by status `waiting_mfa` and, once it moves on, `running`.
   */
  | { type: 'mfa_required'; service: string; message: string }
  /** The agent asked the user questions with options (ask_user); the run ends and the answers come as the next message. */
  | { type: 'questions'; questions: UserQuestion[] }
  /** The agent showed something in the conversation (show_html). The content is in RunResult.displays. */
  | { type: 'display'; kind: Display['kind']; title: string };

/** One option of a question to the user (ask_user). */
export interface UserQuestionOption {
  label: string;
  description?: string;
}

/** A question the agent asks with choices; the user can always answer in their own words too. */
export interface UserQuestion {
  question: string;
  /** A short tag for the question (a few words), e.g. "Format". */
  header?: string;
  options: UserQuestionOption[];
  /** The user may pick several options. */
  multiSelect?: boolean;
}

/**
 * Something the agent shows in the conversation besides its text (show_html):
 * the host renders it, isolated from the app.
 */
export interface Display {
  kind: 'html';
  title: string;
  /** A complete HTML document (inline CSS and JS). */
  content: string;
}

export interface PlanStep {
  title: string;
  status: 'pending' | 'in_progress' | 'done' | 'skipped';
}

export interface EventSink {
  emit(event: EngineEvent): void | Promise<void>;
}

// ------------------------------------------------------------------ users

/** Who the agent works for. `facts` are free-form lines added to the system prompt (organization, role...). */
export interface UserProfile {
  id: string;
  name: string;
  language: string;
  timezone: string;
  facts?: string[];
}

export interface Limits {
  /** Model calls per run. Each subagent gets its own step budget (tokens are shared, see maxTokens). */
  maxSteps: number;
  /** Tokens (in + out) per run, subagents included. 0 = no limit. */
  maxTokens: number;
  /** 0 disables delegation. */
  maxSubagentDepth: number;
  /** Characters of SOUL.md, USER.md and MEMORY.md (they go into every prompt, so they stay small). */
  soulChars: number;
  userChars: number;
  notesChars: number;
  maxParallelSubagents: number;
  /** Schedules a user may have. */
  maxSchedules: number;
  toolTimeoutMs: number;
  /** How long a run waits for an approval before treating it as rejected. */
  approvalTimeoutMs: number;
}

export const DEFAULT_LIMITS: Limits = {
  maxSteps: 20,
  maxTokens: 0,
  maxSubagentDepth: 2,
  soulChars: 3000,
  userChars: 1500,
  notesChars: 2500,
  maxParallelSubagents: 3,
  maxSchedules: 10,
  toolTimeoutMs: 60_000,
  approvalTimeoutMs: 24 * 60 * 60 * 1000,
};

export interface RunResult {
  status: 'done' | 'failed' | 'cancelled';
  /** Final answer shown to the user. */
  content: string;
  /** Messages produced by this run, in order (assistant turns, tool results, applied steers), for the host to persist. */
  messages: ChatMessage[];
  toolCalls: ToolCallView[];
  usage: { inputTokens: number; outputTokens: number; steps: number };
  error?: string;
  /** Set when the run ended by asking the user something (ask_user): `content` is the question as text. */
  awaitingUser?: boolean;
  /** The questions with options, when ask_user gave them: hosts can show them as choices. */
  questions?: UserQuestion[];
  /** What the agent showed besides text (show_html), in order. */
  displays?: Display[];
}
