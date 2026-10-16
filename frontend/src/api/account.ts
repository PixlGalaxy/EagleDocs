import { api, apiUrl, ApiError } from './client';
import type {
  CanvasAnnouncement,
  CanvasCourse,
  CanvasItem,
  Connection,
  ConnectionsInfo,
  McpInfo,
  McpScope,
  MemoryDoc,
  MemoryInfo,
  BrowserInfo,
  RagSummary,
  OAuthConsent,
  PlanInfo,
  UsageInfo,
  PushKind,
  DailySummary,
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
  /** One file's name, size and date. */
  stat: (path: string) => api.get<WorkspaceEntry>(`/files/stat?path=${encodeURIComponent(path)}`),
  /** Overwrites an existing text file (the workspace preview's editor). */
  saveText: (path: string, content: string) => api.put<WorkspaceEntry>('/files/content', { path, content }),
  /**
   * Same as `upload`, with progress (0..1) for the chat's attachment chips. XHR, because
   * fetch cannot report upload progress; `signal` cancels it.
   */
  uploadWithProgress: (dir: string, file: File, onProgress: (fraction: number) => void, signal?: AbortSignal) =>
    new Promise<WorkspaceEntry>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', apiUrl(`/files/upload?path=${encodeURIComponent(dir)}`));
      xhr.withCredentials = true;
      const csrf = document.cookie
        .split('; ')
        .find((part) => part.startsWith('csrf='))
        ?.slice('csrf='.length);
      if (csrf) xhr.setRequestHeader('X-CSRF-Token', decodeURIComponent(csrf));
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
      xhr.onload = () => {
        let body: { error?: string } & Partial<WorkspaceEntry> = {};
        try {
          body = JSON.parse(xhr.responseText || '{}');
        } catch {
          // Not JSON (a proxy error page): the status says enough.
        }
        if (xhr.status >= 200 && xhr.status < 300) resolve(body as WorkspaceEntry);
        else reject(new ApiError(xhr.status, body.error ?? xhr.statusText ?? 'Upload failed'));
      };
      xhr.onerror = () => reject(new ApiError(0, 'Network error'));
      xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'));
      signal?.addEventListener('abort', () => xhr.abort());
      const form = new FormData();
      form.append('file', file);
      xhr.send(form);
    }),
};

export const browserApi = {
  get: () => api.get<BrowserInfo>('/browser'),
  trust: (domain: string) => api.post<{ domain: string }>('/browser/trusted', { domain }),
  untrust: (domain: string) => api.del<void>(`/browser/trusted/${encodeURIComponent(domain)}`),
  clearProfile: (profile: string) => api.del<void>(`/browser/profiles/${encodeURIComponent(profile)}`),
};

export const ragsApi = {
  list: () => api.get<RagSummary[]>('/rags'),
  remove: (id: string) => api.del<void>(`/rags/${encodeURIComponent(id)}`),
};

export const memoryApi = {
  get: () => api.get<MemoryInfo>('/memories'),
  save: (doc: MemoryDoc, content: string) => api.put<Omit<MemoryInfo, 'paused'>>(`/memories/docs/${doc}`, { content }),
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
  dailySummary: () => api.get<DailySummary>('/push/daily-summary'),
  saveDailySummary: (body: { enabled: boolean; hour: number }) => api.put<DailySummary>('/push/daily-summary', body),
  previewDailySummary: () => api.post<{ nothing_due: boolean; sent: number }>('/push/daily-summary/preview'),
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
  /** Settings → Usage: compute units, StudyHawk-model use and storage. */
  usage: () => api.get<UsageInfo>('/usage'),
  tiers: () => api.get<PlanInfo['tier'][]>('/billing/tiers'),
  checkout: (tierId: string) => api.post<{ url: string }>('/billing/checkout', { tierId }),
  portal: () => api.post<{ url: string }>('/billing/portal'),
};
