import { api, apiUrl } from './client';
import type { Approval, BackgroundJob, Chat, CodexDeviceStart, ContextUsage, Connection, Job, Message, ModelOption, Steer, StreamEvent, UserModelPrefs } from './types';

export const chatApi = {
  list: () => api.get<Chat[]>('/chats'),
  create: (body: { title?: string; model_ref?: string | null }) => api.post<Chat>('/chats', body),
  get: (id: string) =>
    api.get<{
      chat: Chat;
      messages: Message[];
      pending_approvals: Approval[];
      background_jobs: BackgroundJob[];
      /** Context use of the last run (null before the first one; missing on older servers). */
      context?: ContextUsage | null;
    }>(`/chats/${id}`),
  rename: (id: string, title: string) => api.patch<Chat>(`/chats/${id}`, { title }),
  remove: (id: string) => api.del<void>(`/chats/${id}`),
  /**
   * Queues a job and returns its id; the answer arrives through `stream`.
   * `attachments`: workspace paths (max 10) sent with the message; the text may then be empty.
   */
  send: (id: string, body: { content: string; model_ref: string; attachments?: string[] }) =>
    api.post<{ job_id: string; message: Message }>(`/chats/${id}/messages`, body),
  cancel: (jobId: string) => api.post<void>(`/jobs/${jobId}/cancel`),
  /** Runs a stopped or failed turn again. */
  retry: (jobId: string) => api.post<{ job_id: string; chat_id: string }>(`/jobs/${jobId}/retry`),
  /** Corrects the agent while it works, without stopping it. */
  steer: (jobId: string, content: string) => api.post<Steer>(`/jobs/${jobId}/steer`, { content }),
  decide: (approvalId: string, approve: boolean) =>
    api.post<void>(`/approvals/${approvalId}/${approve ? 'approve' : 'reject'}`),
  jobs: () => api.get<Job[]>('/jobs'),

  /**
   * Opens the SSE stream for a job. The backend replays events after
   * Last-Event-ID, so a dropped connection simply reconnects.
   */
  stream: (chatId: string, jobId: string, onEvent: (event: StreamEvent) => void): (() => void) => {
    const source = new EventSource(apiUrl(`/chats/${chatId}/stream?job=${encodeURIComponent(jobId)}`), {
      withCredentials: true,
    });
    source.onmessage = (e) => {
      const event = JSON.parse(e.data) as StreamEvent;
      onEvent(event);
      if (event.type === 'done' || event.type === 'error') source.close();
    };
    return () => source.close();
  },
};

export const modelsApi = {
  options: () => api.get<ModelOption[]>('/models'),
  prefs: () => api.get<UserModelPrefs>('/models/prefs'),
  savePrefs: (prefs: UserModelPrefs) => api.put<UserModelPrefs>('/models/prefs', prefs),
  codexStart: () => api.post<CodexDeviceStart>('/connections/codex/device'),
  /** Polled until the user approves the code on auth.openai.com. */
  codexPoll: (deviceAuthId: string) =>
    api.post<{ status: 'pending' | 'connected' | 'expired'; connection?: Connection }>('/connections/codex/poll', {
      device_auth_id: deviceAuthId,
    }),
  addApiKey: (body: { provider: string; label: string; api_key: string; base_url?: string }) =>
    api.post<Connection>('/connections/api-keys', body),
};
