/**
 * Whether an address answers like a Canvas API, checked when an admin saves a
 * school. Signed out, Canvas answers `/api/v1/users/self` with 401; a school's
 * web page, a redirect, or `canvas.instructure.com` itself (503) do not.
 * Only a warning: the school still saves, and the admin sees why students
 * would fail to connect.
 */
export type CanvasCheck =
  | { ok: true }
  | { ok: false; problem: 'redirect'; location: string | null }
  | { ok: false; problem: 'status'; status: number }
  | { ok: false; problem: 'unreachable' };

const TIMEOUT_MS = 8000;

export async function checkCanvas(baseUrl: string): Promise<CanvasCheck | null> {
  if (!baseUrl) return null;
  try {
    const res = await fetch(`${baseUrl}/api/v1/users/self`, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status === 401) return { ok: true };
    if (res.status >= 300 && res.status < 400) return { ok: false, problem: 'redirect', location: res.headers.get('location') };
    return { ok: false, problem: 'status', status: res.status };
  } catch {
    return { ok: false, problem: 'unreachable' };
  }
}
