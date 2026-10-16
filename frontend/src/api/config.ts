import { api } from './client';
import type { PublicInstitution } from './types';

export interface RuntimeConfig {
  language: string;
  defaultThemeMode: string;
  defaultThemeSkin: string;
  registrationEnabled: boolean;
  /** False while SMTP is not configured: sign-up cannot send the verification email. */
  emailConfigured: boolean;
  /** Beta test (Admin -> General): sign-up shows the beta notice; testers sign in. */
  betaTest: boolean;
  institutions: PublicInstitution[];
  billingEnabled: boolean;
  /** Admin switch and circuit breaker combined: false hides "Connect ChatGPT". */
  codexEnabled: boolean;
  /** StudyHawk as an MCP app for ChatGPT/Claude. */
  mcpEnabled: boolean;
  /** Public VAPID key; null while push is not configured. */
  vapidPublicKey: string | null;
  broadcast: { id: string; title: string; body: string; url: string | null } | null;
}

let pending: Promise<RuntimeConfig> | null = null;

/** Server-provided defaults, fetched once and shared by every consumer. */
export function getRuntimeConfig(): Promise<RuntimeConfig> {
  pending ??= api.get<RuntimeConfig>('/config');
  return pending;
}
