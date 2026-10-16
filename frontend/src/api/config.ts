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
  /** The navbar's BetaTest Bug Report button: beta test on and its Discord channel set. */
  betaReport: boolean;
  institutions: PublicInstitution[];
  billingEnabled: boolean;
  /** Admin switch and circuit breaker combined: false hides "Connect ChatGPT". */
  codexEnabled: boolean;
  /** StudyHawk as an MCP app for ChatGPT/Claude. */
  mcpEnabled: boolean;
  /** Public VAPID key; null while push is not configured. */
  vapidPublicKey: string | null;
  broadcast: { id: string; title: string; body: string; url: string | null } | null;
  /** Public status page (Admin -> General); null when none is set. */
  statusPageUrl: string | null;
}

/** The status page's overall state, read by the server (Better Stack's aggregate_state). */
export type SiteStatusState = 'operational' | 'degraded' | 'downtime' | 'maintenance' | 'unknown';

export function getSiteStatus(): Promise<{ url: string | null; state: SiteStatusState }> {
  return api.get('/status');
}

let pending: Promise<RuntimeConfig> | null = null;

/** Server-provided defaults, fetched once and shared by every consumer. */
export function getRuntimeConfig(): Promise<RuntimeConfig> {
  pending ??= api.get<RuntimeConfig>('/config');
  return pending;
}
