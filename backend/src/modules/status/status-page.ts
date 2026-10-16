import type { SettingsService } from '../../db/settings.js';
import { SETTINGS_KEYS as K } from '../admin/settings-keys.js';

/** Where the status page was before it became a setting; an admin can change or clear it. */
export const DEFAULT_STATUS_PAGE_URL = 'https://onlinestatus.eagledocs.org';

/** Better Stack's overall states (`aggregate_state`), plus `unknown` when there is no page or no answer. */
export type StatusState = 'operational' | 'degraded' | 'downtime' | 'maintenance' | 'unknown';
const KNOWN = new Set<StatusState>(['operational', 'degraded', 'downtime', 'maintenance']);

const CACHE_MS = 60_000;
const TIMEOUT_MS = 5_000;

/** `https://host/path` without a trailing slash, or null when it is not an http(s) URL. */
export function normalizeStatusUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

/**
 * The public status page's overall state, read on the server so the browser
 * needs no CSP exception and any Better Stack URL works. One fetch a minute at
 * most, whatever the traffic.
 */
export class StatusPage {
  private cached: { url: string; state: StatusState; at: number } | null = null;
  private inflight: Promise<StatusState> | null = null;

  constructor(private settings: SettingsService) {}

  url(): string | null {
    return this.settings.getString(K.statusPageUrl, DEFAULT_STATUS_PAGE_URL).trim() || null;
  }

  async status(): Promise<{ url: string | null; state: StatusState }> {
    const url = this.url();
    if (!url) return { url: null, state: 'unknown' };
    if (this.cached?.url === url && Date.now() - this.cached.at < CACHE_MS) return { url, state: this.cached.state };
    this.inflight ??= this.fetchState(url).finally(() => (this.inflight = null));
    const state = await this.inflight;
    this.cached = { url, state, at: Date.now() };
    return { url, state };
  }

  private async fetchState(url: string): Promise<StatusState> {
    try {
      const res = await fetch(`${url}/index.json`, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'application/json' } });
      if (!res.ok) return 'unknown';
      const body = (await res.json()) as { data?: { attributes?: { aggregate_state?: string } } };
      const state = body.data?.attributes?.aggregate_state as StatusState | undefined;
      return state && KNOWN.has(state) ? state : 'unknown';
    } catch {
      return 'unknown';
    }
  }
}
