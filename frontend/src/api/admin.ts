import { api, apiUrl } from './client';
import type { Institution, Tier, User, UserStatus, Role } from './types';

export interface AdminOverview {
  users: { total: number; active: number; pending: number };
  chats_today: number;
  jobs_running: number;
  sandboxes_active: number;
  nodes_online: number;
  alerts: { level: 'warning' | 'error'; message: string; section?: string }[];
}

export interface SystemInfo {
  version: string;
  image_ref: string;
  image_revision: string | null;
  /** The replica that answered this request. */
  node_id: string;
  node_version: string;
  uptime_seconds: number;
  memory_mb: number;
  database: { version: string; size_mb: number; migrations: number };
}

export interface AdminUserRow extends User {
  last_seen_at: string | null;
  verification_expires_at: string | null;
}

export interface SmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  /** Write-only: the backend answers with `password_set` instead. */
  password?: string;
  password_set: boolean;
  from_name: string;
  from_email: string;
}

export interface ModelEndpoint {
  id: string;
  kind: 'ollama' | 'openai_compat';
  name: string;
  base_url: string;
  enabled: boolean;
  models: AdminModel[];
}

export interface AdminModel {
  id: string;
  model_name: string;
  display_name: string;
  tags: string[];
  supports_tools: boolean;
  supports_vision: boolean;
  enabled: boolean;
}

export interface SandboxSettings {
  image: string;
  default_cpu: number;
  default_mem_mb: number;
  default_disk_mb: number;
  max_active_per_node: number;
  idle_timeout_minutes: number;
  network: 'open' | 'blocklist' | 'allowlist';
  network_list: string[];
}

export interface NodeRow {
  id: string;
  hostname: string;
  version: string;
  started_at: string;
  heartbeat_at: string;
  online: boolean;
  sandboxes_active: number;
  jobs_running: number;
}

export interface SandboxRow {
  user_id: string;
  username: string;
  node_id: string;
  status: 'starting' | 'running' | 'stopping' | 'stopped';
  cpu_percent: number | null;
  mem_mb: number | null;
  mem_limit_mb: number;
  disk_used_mb: number;
  disk_limit_mb: number;
  last_active_at: string;
}

export interface GeneralSettings {
  registration_enabled: boolean;
  default_language: string;
  default_theme_mode: string;
  default_theme_skin: string;
  eagledocs_daily_messages: number;
  session_ttl_hours: number;
  /** EagleDocs as an MCP app for ChatGPT/Claude. */
  mcp_enabled: boolean;
  /** Sign in with ChatGPT (Codex OAuth) inside the EagleDocs web app. */
  codex_enabled: boolean;
  /** Set by the circuit breaker when OpenAI starts rejecting calls; null when healthy. */
  codex_disabled_until: string | null;
}

export interface PushSettings {
  vapid_public_key: string | null;
  subscriptions: number;
  contact_email: string;
}

export interface BillingSettings {
  enabled: boolean;
  stripe_secret_set: boolean;
  stripe_webhook_secret_set: boolean;
  stripe_secret_key?: string;
  stripe_webhook_secret?: string;
  grace_days: number;
}

export type LogChannel = 'BACKEND' | 'FRONTEND' | 'AUTH' | 'SYSTEM' | 'ENTRYPOINT';
export type LogLevel = 'INFO' | 'WARN' | 'ERROR';

/** One line from any replica (`app_logs`). */
export interface LogEntry {
  id: number;
  node_id: string;
  time: string;
  channel: LogChannel;
  level: LogLevel;
  message: string;
}

export interface LogPage {
  entries: LogEntry[];
  total: number;
  pages: number;
  limit: number;
  /** Most entries the server keeps, across every replica. */
  capacity: number;
  /** Replicas that have written logs, for the filter. */
  nodes: string[];
}

export interface LogFilters {
  node: string;
  channel: LogChannel | '';
  /** Minimum level. */
  level: 'all' | 'warn' | 'error';
}

export const LOG_PAGE_SIZES = [100, 200, 1000] as const;

const logQuery = (f: LogFilters) =>
  `node=${encodeURIComponent(f.node)}&channel=${encodeURIComponent(f.channel)}&level=${f.level}`;

export const logsApi = {
  list: (limit: number, page: number, filters: LogFilters) =>
    api.get<LogPage>(`/admin/logs?limit=${limit}&page=${page}&${logQuery(filters)}`),
  /** Entries newer than `after`, so a page load and the stream leave no gap. */
  streamUrl: (after: number, filters: LogFilters) => apiUrl(`/admin/logs/stream?after=${after}&${logQuery(filters)}`),
};

export const adminApi = {
  overview: () => api.get<AdminOverview>('/admin/overview'),
  system: () => api.get<SystemInfo>('/admin/system'),

  users: (q = '') => api.get<AdminUserRow[]>(`/admin/users?q=${encodeURIComponent(q)}`),
  createUser: (body: { email: string; username: string; display_name: string; password: string; role: Role; tier_id: string | null }) =>
    api.post<AdminUserRow>('/admin/users', body),
  updateUser: (id: string, body: Partial<{ role: Role; status: UserStatus; institution_id: string | null; tier_id: string | null; display_name: string; email: string; username: string }>) =>
    api.patch<AdminUserRow>(`/admin/users/${id}`, body),
  resetPassword: (id: string, password: string) => api.post<void>(`/admin/users/${id}/password`, { password }),
  deleteUser: (id: string) => api.del<void>(`/admin/users/${id}`),

  institutions: () => api.get<Institution[]>('/admin/institutions'),
  saveInstitution: (body: Partial<Institution> & { name: string }) =>
    body.id ? api.put<Institution>(`/admin/institutions/${body.id}`, body) : api.post<Institution>('/admin/institutions', body),
  deleteInstitution: (id: string) => api.del<void>(`/admin/institutions/${id}`),
  builtinSkills: () => api.get<{ slug: string; name: string; description: string; requires?: 'degreeworks' | 'outlook' }[]>('/admin/skills'),

  smtp: () => api.get<SmtpSettings>('/admin/smtp'),
  saveSmtp: (body: SmtpSettings) => api.put<SmtpSettings>('/admin/smtp', body),
  testSmtp: (to: string) => api.post<void>('/admin/smtp/test', { to }),

  endpoints: () => api.get<ModelEndpoint[]>('/admin/models/endpoints'),
  saveEndpoint: (body: Partial<ModelEndpoint> & { name: string; base_url: string; kind: ModelEndpoint['kind']; api_key?: string }) =>
    body.id ? api.put<ModelEndpoint>(`/admin/models/endpoints/${body.id}`, body) : api.post<ModelEndpoint>('/admin/models/endpoints', body),
  deleteEndpoint: (id: string) => api.del<void>(`/admin/models/endpoints/${id}`),
  discoverModels: (id: string) => api.post<ModelEndpoint>(`/admin/models/endpoints/${id}/discover`),
  updateModel: (id: string, body: Partial<AdminModel>) => api.patch<AdminModel>(`/admin/models/${id}`, body),

  sandbox: () => api.get<SandboxSettings>('/admin/sandbox'),
  saveSandbox: (body: SandboxSettings) => api.put<SandboxSettings>('/admin/sandbox', body),
  sandboxes: () => api.get<SandboxRow[]>('/admin/sandboxes'),
  stopSandbox: (userId: string) => api.post<void>(`/admin/sandboxes/${userId}/stop`),
  nodes: () => api.get<NodeRow[]>('/admin/nodes'),

  general: () => api.get<GeneralSettings>('/admin/settings'),
  saveGeneral: (body: Partial<GeneralSettings>) => api.patch<GeneralSettings>('/admin/settings', body),

  push: () => api.get<PushSettings>('/admin/push'),
  savePush: (body: { contact_email: string }) => api.put<PushSettings>('/admin/push', body),
  regenerateVapid: () => api.post<PushSettings>('/admin/push/vapid'),
  broadcast: (body: { title: string; body: string; url: string; institution_id: string | null }) =>
    api.post<{ sent: number }>('/admin/push/broadcast', body),

  tiers: () => api.get<Tier[]>('/admin/tiers'),
  saveTier: (body: Partial<Tier> & { name: string }) =>
    body.id ? api.put<Tier>(`/admin/tiers/${body.id}`, body) : api.post<Tier>('/admin/tiers', body),
  deleteTier: (id: string) => api.del<void>(`/admin/tiers/${id}`),
  billing: () => api.get<BillingSettings>('/admin/billing'),
  saveBilling: (body: Partial<BillingSettings>) => api.put<BillingSettings>('/admin/billing', body),

};
