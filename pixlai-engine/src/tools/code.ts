import type { CodeLanguage, SandboxPort } from '../ports.js';
import { cleanPath } from './files.js';
import { defineTool, type Tool, type ToolContext } from './tool.js';

const LANGUAGES: CodeLanguage[] = ['python', 'node', 'shell'];
const DEFAULT_TIMEOUT_S = 60;
const MAX_TIMEOUT_S = 300;
/** Per stream; the rest is cut from the middle so the start and the error at the end both survive. */
const MAX_OUTPUT_CHARS = 8_000;
const MAX_CODE_CHARS = 100_000;

function sandboxOf(ctx: ToolContext): SandboxPort {
  if (!ctx.sandbox) throw new Error('Code execution is not available here');
  return ctx.sandbox;
}

/** Keeps the head and the tail of long output: tracebacks live at the end. */
export function clipMiddle(text: string, max = MAX_OUTPUT_CHARS): string {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.4);
  const tail = max - head;
  return `${text.slice(0, head)}\n[... ${text.length - max} characters cut ...]\n${text.slice(-tail)}`;
}

export const codeRun = defineTool<{ language: CodeLanguage; code: string; cwd?: string; timeout_s?: number }>({
  name: 'code_run',
  description:
    "Run Python, Node.js or shell code in the user's sandbox. The working directory is their workspace (the same files as " +
    'the files_ tools), so scripts can read and write documents there: compute exactly, analyze CSV/Excel with pandas, ' +
    'make charts with matplotlib, convert or generate PDF/DOCX/PPTX/XLSX. Print what you need to see; save outputs as ' +
    'files and tell the user their paths. State is not kept between calls (write intermediate results to files).',
  parameters: {
    type: 'object',
    properties: {
      language: { type: 'string', enum: LANGUAGES },
      code: { type: 'string', description: 'The whole program' },
      cwd: { type: 'string', description: 'Folder inside the workspace to run in (default: the root)' },
      timeout_s: { type: 'integer', description: `Seconds before it is stopped, 1-${MAX_TIMEOUT_S} (default ${DEFAULT_TIMEOUT_S})` },
    },
    required: ['language', 'code'],
  },
  sideEffect: 'none',
  timeoutMs: (MAX_TIMEOUT_S + 30) * 1000,
  async run(args, ctx) {
    const sandbox = sandboxOf(ctx);
    const language = String(args.language) as CodeLanguage;
    if (!LANGUAGES.includes(language)) throw new Error(`language must be one of: ${LANGUAGES.join(', ')}`);
    const code = String(args.code ?? '');
    if (!code.trim()) throw new Error('code is empty');
    if (code.length > MAX_CODE_CHARS) throw new Error(`code is too long (max ${MAX_CODE_CHARS} characters); put data in files instead`);
    const cwd = args.cwd ? cleanPath(args.cwd) : '';
    const timeoutS = Math.min(MAX_TIMEOUT_S, Math.max(1, Number(args.timeout_s) || DEFAULT_TIMEOUT_S));
    const result = await sandbox.exec(ctx.user.id, { language, code, cwd, timeoutMs: timeoutS * 1000 }, ctx.signal);
    return {
      exit_code: result.exitCode,
      ...(result.timedOut && { timed_out: `stopped after ${timeoutS}s` }),
      ...(result.exitCode === null && !result.timedOut && { killed: 'the process was killed (memory or process limit)' }),
      duration_s: Math.round(result.durationMs / 100) / 10,
      stdout: clipMiddle(result.stdout),
      stderr: clipMiddle(result.stderr),
      ...(result.files?.length && { files: result.files.slice(0, 50).map((f) => ({ path: f.path, size_kb: Math.round(f.size / 102.4) / 10 })) }),
    };
  },
});

export const CODE_TOOLS: Tool[] = [codeRun];
