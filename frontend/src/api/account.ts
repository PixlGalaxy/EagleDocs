import { api, apiUrl } from './client';
import type {
  CanvasAnnouncement,
  CanvasCourse,
  CanvasItem,
  Connection,
  ConnectionsInfo,
  McpInfo,
  McpScope,
  Memory,
  RagSummary,
  OAuthConsent,
  PlanInfo,
  PushKind,
  Schedule,
  Skill,
  TempUsage,
  WorkspaceEntry,
  WorkspaceUsage,
} from './types';

export const connectionsApi = {
  list: () => api.get<ConnectionsInfo>('/connections'),
  saveCanvas: (body: { token: string; base_url?: string }) => api.put<Connection>('/connections/canvas', body),
  saveSso: (body: { email: string; username?: string; password: string }) => api.put<Connection>('/connections/sso', body),
  setDegreeWorks: (enabled: boolean) => api.put<Connection>('/connections/degreeworks', { enabled }),
  test: (id: string) => api.post<Connection>(`/connections/${id}/test`),
  remove: (id: string) => api.del<void>(`/connections/${id}`),
};

export const canvasApi = {
  courses: () => api.get<CanvasCourse[]>('/canvas/courses'),
  upcoming: (days = 14) => api.get<CanvasItem[]>(`/canvas/upcoming?days=${days}`),
  course: (id: number) =>
    api.get<{ course: CanvasCourse; items: CanvasItem[]; announcements: CanvasAnnouncement[] }>(`/canvas/courses/${id}`),
};

export const filesApi = {
  list: (path: string) => api.get<{ entries: WorkspaceEntry[]; usage: WorkspaceUsage; temp: TempUsage }>(`/files?path=${encodeURIComponent(path)}`),
  mkdir: (path: string) => api.post<void>('/files/mkdir', { path }),
  remove: (path: string) => api.del<void>(`/files?path=${encodeURIComponent(path)}`),
  upload: (dir: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.upload<WorkspaceEntry>(`/files/upload?path=${encodeURIComponent(dir)}`, form);
  },
  downloadUrl: (path: string) => apiUrl(`/files/download?path=${encodeURIComponent(path)}`),
};

export const ragsApi = {
  list: () => api.get<RagSummary[]>('/rags'),
  remove: (id: string) => api.del<void>(`/rags/${encodeURIComponent(id)}`),
};

export const memoryApi = {
  list: () => api.get<{ memories: Memory[]; paused: boolean }>('/memories'),
  remove: (id: string) => api.del<void>(`/memories/${id}`),
  update: (id: string, content: string) => api.patch<Memory>(`/memories/${id}`, { content }),
  setPaused: (paused: boolean) => api.put<void>('/memories/paused', { paused }),
};

export const skillsApi = {
  list: () => api.get<Skill[]>('/skills'),
  toggle: (slug: string, enabled: boolean) => api.put<Skill>(`/skills/${slug}/enabled`, { enabled }),
  removeNote: (slug: string, noteId: string) => api.del<void>(`/skills/${slug}/notes/${noteId}`),
  create: (body: { name: string; description: string; body_md: string }) => api.post<Skill>('/skills', body),
  update: (slug: string, body: { name: string; description: string; body_md: string }) => api.put<Skill>(`/skills/${slug}`, body),
  remove: (slug: string) => api.del<void>(`/skills/${slug}`),
};

export const schedulesApi = {
  list: () => api.get<Schedule[]>('/schedules'),
  create: (body: Omit<Schedule, 'id' | 'next_run_at' | 'last_run_at'>) => api.post<Schedule>('/schedules', body),
  update: (id: string, body: Partial<Schedule>) => api.patch<Schedule>(`/schedules/${id}`, body),
  remove: (id: string) => api.del<void>(`/schedules/${id}`),
};

export const pushApi = {
  subscribe: (subscription: PushSubscriptionJSON, kinds: PushKind[]) => api.post<void>('/push/subscriptions', { subscription, kinds }),
  unsubscribe: (endpoint: string) => api.post<void>('/push/unsubscribe', { endpoint }),
  test: () => api.post<void>('/push/test'),
};

export const mcpApi = {
  info: () => api.get<McpInfo>('/mcp-apps'),
  revoke: (id: string) => api.del<void>(`/mcp-apps/${id}`),
  /** Consent screen: details of the request started by ChatGPT/Claude at /oauth/authorize. */
  consent: (requestId: string) => api.get<OAuthConsent>(`/oauth/requests/${encodeURIComponent(requestId)}`),
  /** Returns where to send the browser next (the client's redirect_uri with code or error). */
  decide: (requestId: string, approve: boolean, scopes: McpScope[]) =>
    api.post<{ redirect_to: string }>(`/oauth/requests/${encodeURIComponent(requestId)}`, { approve, scopes }),
};

export const billingApi = {
  plan: () => api.get<PlanInfo>('/billing/plan'),
  tiers: () => api.get<PlanInfo['tier'][]>('/billing/tiers'),
  checkout: (tierId: string) => api.post<{ url: string }>('/billing/checkout', { tierId }),
  portal: () => api.post<{ url: string }>('/billing/portal'),
};
