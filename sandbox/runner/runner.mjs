// EagleDocs sandbox runner: runs inside each user's container and is the only
// way in. The backend calls it over HTTP with the container's own token.
//   POST /exec              run python/node/shell with /workspace as the files
//   POST /browser/<action>  drive a persistent Chromium (one cookie profile per name)
//   GET  /health
import { spawn } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import { join, resolve, sep } from 'node:path';
import { pageOutline } from './snapshot.mjs';

const VERSION = '1';
const WORKSPACE = '/workspace';
const PORT = Number(process.env.RUNNER_PORT || 7070);
const TOKEN = Buffer.from(process.env.RUNNER_TOKEN || '');
delete process.env.RUNNER_TOKEN; // never visible to the code we run
if (TOKEN.length < 32) {
  console.error('RUNNER_TOKEN missing or too short');
  process.exit(1);
}

const MAX_BODY = 2 * 1024 * 1024;
const MAX_STREAM = 1024 * 1024;
const SNAPSHOT_CHARS = 60_000;
const BROWSER_IDLE_MS = 10 * 60_000;
const WALK_LIMIT = 20_000;
const SKIP_DIRS = new Set(['.browser', '.rag', 'node_modules', '__pycache__', '.cache', '.git']);

// The rootfs is read-only: everything that wants a home or a cache uses /tmp.
const HOME = '/tmp/home';
await fs.mkdir(HOME, { recursive: true });
const CHILD_ENV = {
  PATH: process.env.PATH,
  HOME,
  LANG: 'C.UTF-8',
  LC_ALL: 'C.UTF-8',
  TMPDIR: '/tmp',
  MPLBACKEND: 'Agg',
  MPLCONFIGDIR: '/tmp/matplotlib',
  PYTHONUNBUFFERED: '1',
  PYTHONDONTWRITEBYTECODE: '1',
  XDG_CACHE_HOME: '/tmp/cache',
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** A path inside /workspace; refuses anything that escapes it. */
function inWorkspace(rel = '') {
  const clean = String(rel).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (clean.split('/').some((p) => p === '..')) throw new HttpError(400, 'Invalid path');
  const abs = resolve(WORKSPACE, clean);
  if (abs !== WORKSPACE && !abs.startsWith(WORKSPACE + sep)) throw new HttpError(400, 'Invalid path');
  return abs;
}

// ------------------------------------------------------------------ exec

/** path -> "mtime:size" for files under /workspace, to report what a run created or changed. */
async function fileStates() {
  const states = new Map();
  const stack = [WORKSPACE];
  while (stack.length && states.size < WALK_LIMIT) {
    const dir = stack.pop();
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(abs);
        continue;
      }
      const stat = await fs.stat(abs).catch(() => null);
      if (stat) states.set(abs.slice(WORKSPACE.length + 1), `${stat.mtimeMs}:${stat.size}`);
    }
  }
  return states;
}

/** Keeps the last MAX_STREAM bytes: the end of the output (and the traceback) matters most. */
function collector() {
  let chunks = [];
  let bytes = 0;
  let dropped = 0;
  return {
    add(chunk) {
      chunks.push(chunk);
      bytes += chunk.length;
      while (bytes > MAX_STREAM && chunks.length > 1) {
        const first = chunks.shift();
        bytes -= first.length;
        dropped += first.length;
      }
    },
    text() {
      const out = Buffer.concat(chunks).toString('utf8');
      return dropped ? `[${dropped} earlier bytes dropped]\n${out}` : out;
    },
  };
}

const COMMANDS = {
  python: { ext: 'py', cmd: (file) => ['python3', [file]] },
  node: { ext: 'mjs', cmd: (file) => ['node', [file]] },
  shell: { ext: 'sh', cmd: (file) => ['bash', [file]] },
};

async function exec(body) {
  const kind = COMMANDS[body.language];
  if (!kind) throw new HttpError(400, 'language must be python, node or shell');
  const code = String(body.code ?? '');
  const timeoutMs = Math.min(Math.max(Number(body.timeoutMs) || 60_000, 1000), 600_000);
  const cwd = inWorkspace(body.cwd);
  await fs.mkdir(cwd, { recursive: true });

  const file = `/tmp/run-${randomBytes(6).toString('hex')}.${kind.ext}`;
  await fs.writeFile(file, code, { mode: 0o600 });
  const before = await fileStates();
  const started = Date.now();
  const stdout = collector();
  const stderr = collector();

  const result = await new Promise((done) => {
    const [command, args] = kind.cmd(file);
    // detached: its own process group, so a timeout kills everything it started.
    const child = spawn(command, args, { cwd, env: CHILD_ENV, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {}
    }, timeoutMs);
    child.stdout.on('data', (c) => stdout.add(c));
    child.stderr.on('data', (c) => stderr.add(c));
    child.on('error', (err) => {
      clearTimeout(timer);
      done({ exitCode: null, timedOut, error: err.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      try {
        process.kill(-child.pid, 'SIGKILL'); // leftovers (background processes) die with the run
      } catch {}
      done({ exitCode: code, timedOut });
    });
  });
  await fs.rm(file, { force: true });

  const after = await fileStates();
  const files = [];
  for (const [path, state] of after) {
    if (before.get(path) !== state) files.push({ path, size: Number(state.split(':')[1]) });
  }
  return {
    exitCode: result.exitCode,
    stdout: stdout.text(),
    stderr: result.error ? `${stderr.text()}\n${result.error}`.trim() : stderr.text(),
    timedOut: result.timedOut,
    durationMs: Date.now() - started,
    files: files.slice(0, 200),
  };
}

// ------------------------------------------------------------------ browser

/** profile -> { context, page, lastUsed, savedAt } */
const sessions = new Map();
let chromium = null;
/**
 * Chromium drops session cookies (no expiry) when it closes, and many sign-ins
 * (Microsoft without "stay signed in") rely on them. They are kept here so a
 * login survives the browser closing when idle, until the site expires it.
 */
const SESSION_COOKIES = 'eagledocs-session-cookies.json';

async function saveSessionCookies(profile, force = false) {
  const s = sessions.get(profile);
  if (!s || (!force && Date.now() - (s.savedAt ?? 0) < 5000)) return;
  s.savedAt = Date.now();
  const cookies = (await s.context.cookies().catch(() => [])).filter((c) => c.expires === -1);
  await fs.writeFile(join(WORKSPACE, '.browser', profile, SESSION_COOKIES), JSON.stringify(cookies), { mode: 0o600 }).catch(() => {});
}

async function session(profile, create) {
  if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(String(profile))) throw new HttpError(400, 'Invalid profile');
  let s = sessions.get(profile);
  if (!s) {
    if (!create) throw new HttpError(409, 'No page is open in this profile: use browser_open first');
    chromium ??= (await import('playwright-core')).chromium;
    const dir = join(WORKSPACE, '.browser', profile);
    await fs.mkdir(dir, { recursive: true });
    const context = await chromium.launchPersistentContext(dir, {
      headless: true,
      // The container already isolates the browser; Chromium's own sandbox needs privileges we drop.
      chromiumSandbox: false,
      args: ['--disable-dev-shm-usage', '--no-first-run', '--disable-sync', '--disable-features=Translate'],
      viewport: { width: 1280, height: 900 },
      acceptDownloads: false,
      locale: 'en-US',
    });
    const saved = await fs.readFile(join(dir, SESSION_COOKIES), 'utf8').then(JSON.parse, () => []);
    if (Array.isArray(saved) && saved.length) await context.addCookies(saved).catch(() => {});
    const page = context.pages()[0] ?? (await context.newPage());
    s = { context, page, lastUsed: Date.now(), savedAt: 0, crashed: false };
    page.on('crash', () => (s.crashed = true));
    sessions.set(profile, s);
    context.on('close', () => sessions.delete(profile));
    // Sites that open a new tab: follow it.
    context.on('page', (p) => {
      s.page = p;
      p.on('crash', () => (s.crashed = true));
    });
  }
  // A crashed tab (often out of memory on heavy apps) is replaced, so the profile keeps working.
  if (s.page.isClosed() || s.crashed) {
    s.crashed = false;
    s.page = s.context.pages().find((p) => !p.isClosed()) ?? (await s.context.newPage());
    s.page.on('crash', () => (s.crashed = true));
  }
  s.lastUsed = Date.now();
  return s;
}

async function settle(page) {
  await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 3_000 }).catch(() => {});
}

async function view(page) {
  await settle(page);
  const outline = await page.evaluate(pageOutline, SNAPSHOT_CHARS).catch((err) => ({ text: `(could not read the page: ${err.message})`, truncated: false }));
  return {
    url: page.url(),
    title: await page.title().catch(() => ''),
    snapshot: outline.truncated ? `${outline.text}\n[... more below: scroll down]` : outline.text,
  };
}

function target(page, ref) {
  const id = String(ref ?? '').replace(/^@/, '');
  if (!/^e\d{1,6}$/.test(id)) throw new HttpError(400, 'ref must look like "@e12" (from the latest snapshot)');
  return page.locator(`[data-eagle-ref="${id}"]`).first();
}

async function act(page, action) {
  const missing = (err) => {
    if (/strict mode|resolved to 0|Timeout/i.test(err.message)) {
      throw new HttpError(409, `${action.ref} is not on the page anymore: take a new snapshot`);
    }
    throw err;
  };
  switch (action.kind) {
    case 'click':
      await target(page, action.ref).click({ timeout: 10_000 }).catch(missing);
      break;
    case 'type': {
      const el = target(page, action.ref);
      await el.fill(String(action.text ?? ''), { timeout: 10_000 }).catch(missing);
      if (action.submit) await el.press('Enter');
      break;
    }
    case 'press':
      await page.keyboard.press(String(action.key));
      break;
    case 'scroll':
      await page.mouse.wheel(0, action.direction === 'up' ? -800 : 800);
      await page.waitForTimeout(400);
      break;
    case 'back':
      await page.goBack({ timeout: 20_000 }).catch(() => {});
      break;
    default:
      throw new HttpError(400, 'Unknown action');
  }
  await page.waitForTimeout(500);
}

const browserRoutes = {
  async open(body) {
    const url = new URL(String(body.url));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new HttpError(400, 'Only http and https URLs');
    const s = await session(body.profile, true);
    await s.page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 45_000 });
    return view(s.page);
  },
  async snapshot(body) {
    return view((await session(body.profile, false)).page);
  },
  async act(body) {
    const s = await session(body.profile, false);
    await act(s.page, body.action ?? {});
    return view(s.page);
  },
  async screenshot(body) {
    const s = await session(body.profile, false);
    // TEMP/ when the temp area is mounted, so screenshots expire with the rest of the scratch files.
    const temp = await fs.stat(join(WORKSPACE, 'TEMP')).then((st) => st.isDirectory(), () => false);
    const rel = `${temp ? 'TEMP/' : ''}screenshots/${body.profile}-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
    await fs.mkdir(join(WORKSPACE, rel, '..'), { recursive: true });
    await s.page.screenshot({ path: join(WORKSPACE, rel), timeout: 20_000 });
    return { path: rel };
  },
  // ---- Backend-only steps for scripted flows (school sign-in, mail, audits). The model never calls these;
  // credentials typed with `fill` come straight from the backend and are never returned or logged.
  async goto(body) {
    const url = new URL(String(body.url));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new HttpError(400, 'Only http and https URLs');
    const s = await session(body.profile, true);
    await s.page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch((err) => {
      // A login redirect chain can abort the first navigation; what matters is where we end up.
      if (!/ERR_ABORTED|frame was detached/i.test(err.message)) throw err;
    });
    await settle(s.page);
    return { url: s.page.url(), title: await s.page.title().catch(() => '') };
  },
  /** Runs `script` (a function body receiving `arg`) in the page and returns its JSON result. */
  async eval(body) {
    const s = await session(body.profile, false);
    const result = await s.page.evaluate(([source, arg]) => new Function('arg', source)(arg), [String(body.script), body.arg ?? null]);
    return { url: s.page.url(), result: result ?? null };
  },
  /** Fills the first visible element matching `selector`; optionally presses Enter. */
  async fill(body) {
    const s = await session(body.profile, false);
    const el = s.page.locator(String(body.selector)).filter({ visible: true }).first();
    await el.fill(String(body.value ?? ''), { timeout: 10_000 });
    if (body.submit) await el.press('Enter');
    await s.page.waitForTimeout(400);
    return { ok: true };
  },
  /**
   * Types key by key into the first visible match, like a person: recipient pickers and search boxes
   * often ignore text that is pasted in at once. `key` (e.g. Enter, Tab) is pressed after typing.
   */
  async type(body) {
    const s = await session(body.profile, false);
    const el = s.page.locator(String(body.selector)).filter({ visible: true }).first();
    await el.click({ timeout: 10_000 });
    await el.pressSequentially(String(body.value ?? ''), { delay: 20, timeout: 30_000 });
    if (body.key) await el.press(String(body.key));
    await s.page.waitForTimeout(800);
    return { ok: true };
  },
  /** Clicks the first visible element matching `selector`. */
  async tap(body) {
    const s = await session(body.profile, false);
    await s.page.locator(String(body.selector)).filter({ visible: true }).first().click({ timeout: 10_000 });
    await s.page.waitForTimeout(400);
    return { ok: true };
  },
  async wait(body) {
    const s = await session(body.profile, false);
    await s.page.waitForTimeout(Math.min(Math.max(Number(body.ms) || 1000, 100), 15_000));
    await settle(s.page);
    return { url: s.page.url(), title: await s.page.title().catch(() => '') };
  },
  async url(body) {
    const s = sessions.get(body.profile);
    return { url: s ? s.page.url() : null };
  },
  async close(body) {
    const s = sessions.get(body.profile);
    if (s) {
      await saveSessionCookies(body.profile, true);
      sessions.delete(body.profile);
      await s.context.close().catch(() => {});
    }
    return { closed: true };
  },
};

// Idle browsers use a lot of memory: close them; cookies stay on disk.
setInterval(() => {
  for (const [profile, s] of sessions) {
    if (Date.now() - s.lastUsed > BROWSER_IDLE_MS) void browserRoutes.close({ profile });
  }
}, 60_000).unref();

// ------------------------------------------------------------------ http

function authorized(req) {
  const given = Buffer.from(String(req.headers.authorization ?? '').replace(/^Bearer /, ''));
  return given.length === TOKEN.length && timingSafeEqual(given, TOKEN);
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'Request too large');
    chunks.push(chunk);
  }
  try {
    return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}

/** Last activity, for the manager's idle check (GET /health). */
let lastActivity = Date.now();

const server = http.createServer(async (req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  try {
    if (!authorized(req)) return send(401, { error: 'unauthorized' });
    const url = new URL(req.url, 'http://runner');
    if (req.method === 'GET' && url.pathname === '/health') {
      return send(200, { ok: true, version: VERSION, browsers: [...sessions.keys()], idle_ms: Date.now() - lastActivity });
    }
    if (req.method !== 'POST') throw new HttpError(405, 'POST only');
    lastActivity = Date.now();
    const body = await readJson(req);
    if (url.pathname === '/exec') return send(200, await exec(body));
    const action = /^\/browser\/([a-z]+)$/.exec(url.pathname)?.[1];
    if (action && Object.hasOwn(browserRoutes, action)) {
      const out = await browserRoutes[action](body);
      if (action !== 'close' && action !== 'url') await saveSessionCookies(body.profile);
      return send(200, out);
    }
    throw new HttpError(404, 'Not found');
  } catch (err) {
    send(err instanceof HttpError ? err.status : 500, { error: err.message });
  } finally {
    lastActivity = Date.now();
  }
});

server.listen(PORT, '0.0.0.0', () => console.log(`runner ${VERSION} listening on ${PORT}`));
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, async () => {
    for (const profile of sessions.keys()) await browserRoutes.close({ profile });
    process.exit(0);
  });
}
