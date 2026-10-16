import { api } from './client';

export const contactApi = {
  /** `website` is the honeypot: always empty for a person. */
  send: (body: { name: string; email: string; message: string; website: string }) => api.post<void>('/contact', body),
};
