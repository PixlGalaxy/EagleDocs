import type { BrowserAction, BrowserPage, BrowserPort, ExecRequest, ExecResult, SandboxPort } from 'pixlai-engine';
import type { SandboxHandle, SandboxManager } from '../modules/sandbox/manager.js';
import type { DiskWorkspace } from './workspace.js';
import { assertPublicUrl } from './web.js';

/** Request timeout on top of what the call itself is allowed to take. */
const MARGIN_MS = 15_000;
const BROWSER_MS = 75_000;

class RunnerError extends Error {}

/**
 * The engine's SandboxPort and BrowserPort over the user's sandbox runner.
 * The sandbox is started on the first call and kept alive by use; a call that
 * finds it dead (memory limit, Docker restart) starts a new one and retries once.
 */
export class SandboxTools implements SandboxPort, BrowserPort {
  constructor(
    private manager: SandboxManager,
    private workspace: DiskWorkspace,
  ) {}

  async describe(userId: string): Promise<string> {
    const { cpu, memMb } = await this.manager.limitsFor(userId);
    return [
      `Ubuntu with Python 3 (pandas, numpy, matplotlib, openpyxl, python-docx, python-pptx, pymupdf, pypdf, reportlab, requests),`,
      `Node.js and bash. Limits: ${cpu} CPU, ${memMb} MB of memory, 256 processes. Files written under the workspace persist;`,
      'everything else is reset when the sandbox stops after a few idle minutes. Only workspace files survive between runs.',
    ].join(' ');
  }

  /** A runner step for the backend's own scripted flows (school sign-in, mail, Degree Works). */
  runner<T>(userId: string, path: string, body: unknown, signal: AbortSignal, timeoutMs = BROWSER_MS): Promise<T> {
    return this.call<T>(userId, path, body, timeoutMs, signal);
  }

  private async call<T>(userId: string, path: string, body: unknown, timeoutMs: number, signal: AbortSignal): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const handle = await this.manager.ensure(userId);
      try {
        return await this.post<T>(handle, path, body, timeoutMs, signal);
      } catch (err) {
        if (err instanceof RunnerError || signal.aborted || attempt > 0) throw err;
        // Connection-level failure: the container is gone. Start a fresh one and try again.
        this.manager.forget(userId);
      }
    }
  }

  private async post<T>(handle: SandboxHandle, path: string, body: unknown, timeoutMs: number, signal: AbortSignal): Promise<T> {
    this.manager.touch(handle);
    const res = await fetch(`${handle.baseUrl}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${handle.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs + MARGIN_MS)]),
    });
    this.manager.touch(handle);
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new RunnerError(data.error ?? `The sandbox answered ${res.status}`);
    return data;
  }

  // ---------------------------------------------------------------- SandboxPort

  /**
   * Docker cannot cap a bind-mounted folder, so the quota is checked around each run: no code runs while the
   * workspace is over its limit, and a run that pushed it over says so (the file tools refuse to write too).
   */
  async exec(userId: string, request: ExecRequest, signal: AbortSignal): Promise<ExecResult> {
    const over = await this.overQuota(userId);
    if (over) throw new Error(`The workspace is full (${over}). Delete files (or move scratch work to TEMP/) before running code.`);
    const result = await this.call<ExecResult>(userId, '/exec', request, request.timeoutMs, signal);
    if (result.files?.length) {
      this.workspace.forgetUsage(userId);
      const after = await this.overQuota(userId);
      if (after) result.stderr = `${result.stderr}
[EagleDocs] The workspace is now over its quota (${after}): delete files before writing more.`.trim();
    }
    return result;
  }

  private async overQuota(userId: string): Promise<string | null> {
    const MB = 1048576;
    for (const area of await this.workspace.usage(userId)) {
      if (area.usedBytes > area.limitBytes) return `${area.name}: ${Math.round(area.usedBytes / MB)} MB of ${Math.round(area.limitBytes / MB)} MB`;
    }
    return null;
  }

  // ---------------------------------------------------------------- BrowserPort

  /**
   * The agent's browser only opens public sites (not the server's network or cloud metadata).
   * A page can still redirect or link inward: the sandbox network filter is what closes that.
   */
  async open(userId: string, profile: string, url: string, signal: AbortSignal): Promise<BrowserPage> {
    await assertPublicUrl(url);
    return this.call(userId, '/browser/open', { profile, url }, BROWSER_MS, signal);
  }

  /** A page read in its own tab of the shared reading browser (parallel helpers do not step on each other). */
  async read(userId: string, url: string, signal: AbortSignal): Promise<BrowserPage> {
    await assertPublicUrl(url);
    return this.call(userId, '/browser/read', { url }, BROWSER_MS, signal);
  }

  snapshot(userId: string, profile: string, signal: AbortSignal): Promise<BrowserPage> {
    return this.call(userId, '/browser/snapshot', { profile }, BROWSER_MS, signal);
  }

  act(userId: string, profile: string, action: BrowserAction, signal: AbortSignal): Promise<BrowserPage> {
    return this.call(userId, '/browser/act', { profile, action }, BROWSER_MS, signal);
  }

  screenshot(userId: string, profile: string, signal: AbortSignal): Promise<{ path: string }> {
    return this.call(userId, '/browser/screenshot', { profile }, BROWSER_MS, signal);
  }

  /** Never starts a sandbox: no sandbox means no open page. */
  async currentUrl(userId: string, profile: string): Promise<string | null> {
    if (!this.manager.isRunning(userId)) return null;
    const handle = await this.manager.ensure(userId);
    const res = await this.post<{ url: string | null }>(handle, '/browser/url', { profile }, 10_000, AbortSignal.timeout(15_000)).catch(() => ({ url: null }));
    return res.url;
  }

  async close(userId: string, profile: string): Promise<void> {
    if (!this.manager.isRunning(userId)) return;
    const handle = await this.manager.ensure(userId);
    await this.post(handle, '/browser/close', { profile }, 10_000, AbortSignal.timeout(15_000)).catch(() => undefined);
  }
}
