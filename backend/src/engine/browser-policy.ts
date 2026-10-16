import type { BrowserPolicy } from 'pixlai-engine';
import type { Db } from '../db/pool.js';
import { many } from '../db/pool.js';

/** Canvas is read-only in StudyHawk everywhere, including through the browser. */
const CANVAS_HOSTS = /(^|\.)instructure\.com$/i;

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** "canvas.fgcu.edu" is covered by a trusted "fgcu.edu". */
function matches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** Lowercase hostname for the trust list, or null when it is not one ("https://x.edu/a" → "x.edu"). */
export function normalizeDomain(input: string): string | null {
  const raw = input.trim().toLowerCase();
  const host = hostOf(/^[a-z]+:\/\//.test(raw) ? raw : `https://${raw}`);
  if (!host || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) || host.length > 253) return null;
  return host.replace(/^www\./, '');
}

/**
 * StudyHawk' rule for the agent acting in the user's browser:
 * - never on Canvas (the school's Canvas URL and any *.instructure.com): reading is fine, acting is blocked;
 * - freely on sites the user trusts (Settings → Browser);
 * - with the user's approval everywhere else.
 */
export function studyhawkBrowserPolicy(db: Db): BrowserPolicy {
  return async (userId, url) => {
    const host = hostOf(url);
    if (!host) return 'approve';
    const rows = await many<{ canvas_host: string | null; trusted: string[] | null }>(
      db,
      `SELECT coalesce(c.meta->>'base_url', i.canvas_base_url) AS canvas_host,
              (SELECT array_agg(domain) FROM browser_trusted_domains WHERE user_id = u.id) AS trusted
         FROM users u
         LEFT JOIN institutions i ON i.id = u.institution_id
         LEFT JOIN connections c ON c.user_id = u.id AND c.kind = 'canvas'
        WHERE u.id = $1`,
      [userId],
    );
    const canvas = hostOf(rows[0]?.canvas_host);
    if (CANVAS_HOSTS.test(host) || (canvas && matches(host, canvas))) {
      return { block: 'StudyHawk never acts on Canvas (read-only): use the canvas_ tools to read it, and tell the student what to do there themselves.' };
    }
    if ((rows[0]?.trusted ?? []).some((domain) => matches(host, domain))) return 'allow';
    return 'approve';
  };
}
