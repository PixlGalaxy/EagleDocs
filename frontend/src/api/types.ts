// Shapes returned by the backend. This file is the contract the backend
// (plans/01-arquitectura.md) implements: keep both in sync.

export type Role = 'admin' | 'user';
export type UserStatus = 'pending' | 'active' | 'disabled';

export interface Institution {
  id: string;
  name: string;
  slug: string;
  canvas_base_url: string;
  degreeworks_url: string | null;
  sso_login_url: string | null;
  outlook_url: string | null;
  enabled: boolean;
  domains: InstitutionDomain[];
  skills: Record<string, boolean>;
  user_count?: number;
}

export interface InstitutionDomain {
  id: string;
  domain: string;
  include_subdomains: boolean;
}

export interface User {
  id: string;
  email: string;
  username: string;
  display_name: string | null;
  avatar_path: string | null;
  role: Role;
  status: UserStatus;
  institution_id: string | null;
  institution_name: string | null;
  tier_id: string | null;
  language: string;
  timezone: string | null;
  major: string | null;
  theme_mode: string;
  theme_skin: string;
  created_at: string;
  updated_at: string;
}

export interface SessionInfo {
  user: User;
}

export interface RegisterResult {
  email: string;
  /** When the unverified account is deleted if it is still not verified. */
  expires_at: string;
}

/** Pieces of the institution list that are safe to show signed out (register page). */
export interface PublicInstitution {
  name: string;
  domains: string[];
}

// ---------------------------------------------------------------- models

export type ProviderKind = 'eagledocs' | 'codex' | 'openai_compat' | 'anthropic';
export type ModelTier = 'fast' | 'smart' | 'code' | 'vision';

export interface ModelOption {
  /** `provider:source:model`, or `auto`. */
  ref: string;
  provider: ProviderKind;
  label: string;
  /** Which connection or endpoint it comes from, for grouping in the picker. */
  source_label: string;
  tags: ModelTier[];
  supports_tools: boolean;
  supports_vision: boolean;
}

export interface UserModelPrefs {
  mode: 'manual' | 'auto';
  default_model_ref: string | null;
  auto_map: Partial<Record<ModelTier, string>>;
}

export interface CodexDeviceStart {
  verification_uri: string;
  user_code: string;
  device_auth_id: string;
  interval: number;
  expires_at: string;
}

// ---------------------------------------------------------------- chat

export interface Chat {
  id: string;
  title: string;
  model_ref: string | null;
  created_at: string;
  updated_at: string;
  /** Set while a job for this chat is running in the background. */
  active_job_id: string | null;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: 'running' | 'done' | 'error' | 'waiting_approval' | 'rejected';
  result_preview?: string;
  /** agent_delegate while it runs: what each helper agent is doing. */
  subagents?: SubagentProgress[];
}

/** One helper agent, followed through its `subagent` events. */
export interface SubagentProgress {
  index: number;
  task: string;
  /** The model the main agent picked for it. */
  model?: string;
  status: 'running' | 'done' | 'failed' | 'cancelled';
  steps: ToolCall[];
}

/** Helper agents working in the background for a chat (agent_delegate with background). */
export interface BackgroundJob {
  id: string;
  status: JobStatus;
  tasks: { goal: string }[];
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  model_ref: string | null;
  /** Human label of the model that answered, e.g. "Auto -> GPT-5". */
  model_label?: string | null;
  tool_calls?: ToolCall[];
  /** A correction sent while the agent was working. */
  steer?: boolean;
  /** Reports of helper agents that worked in the background: shown as a card, not as the user's words. */
  background?: { job_id: string; tasks: { goal: string; status: string }[] };
  created_at: string;
}

export interface Approval {
  id: string;
  job_id: string;
  tool_name: string;
  /** What will happen, already formatted by the backend for display. */
  summary: string;
  details: Record<string, string>;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
}

export type JobStatus =
  | 'queued'
  | 'running'
  | 'waiting_approval'
  | 'waiting_mfa'
  | 'done'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

/** One server-sent event from GET /api/chats/:id/stream. */
export type StreamEvent =
  | { type: 'status'; status: JobStatus; queue_position?: number }
  | { type: 'model'; model_ref: string; model_label: string }
  | { type: 'delta'; text: string }
  | { type: 'tool_call'; call: ToolCall }
  | { type: 'tool_result'; call: ToolCall }
  | { type: 'approval_required'; approval: Approval }
  | { type: 'mfa_required'; service: string; message: string }
  /** A correction the user sent while it worked was taken into account. */
  | { type: 'steer_applied'; id: string; content: string }
  /** The answer being written was cut short by a correction; a new one starts. */
  | { type: 'interrupted' }
  | { type: 'notice'; message: string }
  /** Progress of a helper agent started by the agent_delegate tool. */
  | { type: 'subagent'; parent_call_id: string; index: number; task: string; model_label?: string; event: StreamEvent }
  /** The reports of background helpers entered the chat, right before the answer that uses them. */
  | { type: 'background_results'; message: Message }
  /** A background helper job ends with `done` and no message. */
  | { type: 'done'; message: Message }
  | { type: 'error'; error: string };

/** A correction sent while the agent works (POST /jobs/:id/steer). */
export interface Steer {
  id: string;
  content: string;
  created_at: string;
}

// ---------------------------------------------------------------- canvas

export interface CanvasCourse {
  id: number;
  name: string;
  course_code: string;
  term: string | null;
  current_score: number | null;
  current_grade: string | null;
  /** In a term running now (organization pages and past terms are false). */
  current?: boolean;
}

export interface CanvasItem {
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
  /** 0-100 from the canvas-lms priority formula. */
  priority: number | null;
  html_url: string;
}

export interface CanvasAnnouncement {
  id: number;
  course_id: number;
  title: string;
  posted_at: string;
  preview: string;
  html_url: string;
}

// ---------------------------------------------------------------- connections

export type ConnectionKind = 'canvas' | 'sso' | 'degreeworks' | 'codex' | 'api_key';
export type ConnectionStatus = 'ok' | 'error' | 'untested' | 'waiting_mfa';

/** Secrets never come back to the browser, only whether they are set. */
export interface Connection {
  id: string;
  kind: ConnectionKind;
  provider: string | null;
  label: string;
  status: ConnectionStatus;
  last_ok_at: string | null;
  last_error: string | null;
  meta: Record<string, string>;
}

/** What the user's institution offers, so Settings only shows relevant cards. */
export interface ConnectionsInfo {
  connections: Connection[];
  institution: {
    name: string;
    canvas_base_url: string;
    has_degreeworks: boolean;
    has_outlook: boolean;
  } | null;
}

// ---------------------------------------------------------------- files

export interface WorkspaceEntry {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size: number;
  modified_at: string;
  /** The TEMP folder: files there are deleted 24 h after their last change. */
  temp?: boolean;
}

export interface WorkspaceUsage {
  used_mb: number;
  limit_mb: number;
}

export interface TempUsage extends WorkspaceUsage {
  ttl_hours: number;
}

/** Settings → Browser. */
export interface BrowserInfo {
  /** The server has sandboxes (Docker); without them the agent has no browser. */
  available: boolean;
  trusted: { domain: string; created_at: string }[];
  /** Cookie profiles the agent’s browser has saved ("default", "outlook"...). */
  profiles: string[];
}

/** Settings -> RAGs: a searchable index the agent built from the user's files. */
export interface RagSummary {
  id: string;
  name: string;
  description: string;
  model: string;
  chunks: number;
  sources: { path: string; pages: number; chunks: number; added_at: string }[];
  size_mb: number;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------- agent extras

export interface Memory {
  id: string;
  content: string;
  source: 'agent' | 'user';
  created_at: string;
}

export interface Skill {
  slug: string;
  name: string;
  description: string;
  builtin: boolean;
  enabled: boolean;
  notes: SkillNote[];
  body_md?: string;
}

export interface SkillNote {
  id: string;
  note: string;
  created_at: string;
}

export interface Schedule {
  id: string;
  name: string;
  cron: string;
  prompt: string;
  enabled: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
}

export interface Job {
  id: string;
  chat_id: string | null;
  chat_title: string | null;
  kind: 'chat' | 'scheduled' | 'sync';
  status: JobStatus;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
}

// ---------------------------------------------------------------- MCP apps

export type McpScope = 'canvas.read' | 'degreeworks.read' | 'workspace' | 'memory';

/** An MCP client (ChatGPT, Claude...) the student authorized through OAuth. */
export interface McpApp {
  id: string;
  client_name: string;
  client_uri: string | null;
  scopes: McpScope[];
  created_at: string;
  last_used_at: string | null;
}

export interface McpInfo {
  enabled: boolean;
  /** Full URL to paste into ChatGPT / Claude, e.g. https://eagledocs.org/mcp */
  server_url: string;
  apps: McpApp[];
}

/** A pending OAuth authorization request, shown on the consent screen. */
export interface OAuthConsent {
  request_id: string;
  client_name: string;
  client_uri: string | null;
  redirect_uri: string;
  scopes: McpScope[];
}

// ---------------------------------------------------------------- billing

export interface Tier {
  id: string;
  name: string;
  price_cents: number;
  currency: string;
  stripe_price_id: string | null;
  cpu: number;
  mem_mb: number;
  disk_mb: number;
  daily_messages: number;
  max_background_jobs: number;
  max_schedules: number;
  is_default: boolean;
  enabled: boolean;
}

export interface PlanInfo {
  tier: Tier;
  billing_enabled: boolean;
  subscription_status: string | null;
  current_period_end: string | null;
  usage_today: { messages: number; tokens_in: number; tokens_out: number };
}

// ---------------------------------------------------------------- push

export type PushKind = 'mfa_required' | 'job_done' | 'approval_required' | 'broadcast';
