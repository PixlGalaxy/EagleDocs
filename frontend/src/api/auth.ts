import { api, apiUrl } from './client';
import type { RegisterResult, SessionInfo, User } from './types';

export const authApi = {
  me: () => api.get<SessionInfo>('/auth/me'),
  login: (usernameOrEmail: string, password: string) =>
    api.post<SessionInfo>('/auth/login', { usernameOrEmail, password }),
  logout: () => api.post<void>('/auth/logout'),
  register: (body: { email: string; username: string; displayName: string; password: string }) =>
    api.post<RegisterResult>('/auth/register', body),
  verifyToken: (token: string) => api.post<SessionInfo>('/auth/verify', { token }),
  verifyCode: (email: string, code: string) => api.post<SessionInfo>('/auth/verify', { email, code }),
  resendVerification: (email: string) => api.post<void>('/auth/resend-verification', { email }),
  forgotPassword: (email: string) => api.post<void>('/auth/forgot-password', { email }),
  resetPassword: (token: string, newPassword: string) => api.post<void>('/auth/reset-password', { token, newPassword }),
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post<void>('/auth/change-password', { currentPassword, newPassword }),
  updateProfile: (body: Partial<Pick<User, 'display_name' | 'major' | 'timezone'>>) => api.patch<User>('/auth/profile', body),
  appearance: (body: { mode?: string; skin?: string; language?: string }) => api.post<User>('/auth/appearance', body),
};

export const avatarsApi = {
  url: (userId: string) => apiUrl(`/avatars/${userId}`),
  upload: (file: Blob) => {
    const form = new FormData();
    form.append('avatar', file, 'avatar.png');
    return api.upload<User>('/avatars', form);
  },
  remove: () => api.del<User>('/avatars'),
};
