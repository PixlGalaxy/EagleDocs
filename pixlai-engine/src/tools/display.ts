import { defineTool, type Tool } from './tool.js';

const MAX_HTML_CHARS = 200_000;

/**
 * An interactive page shown inside the conversation. The host renders it
 * isolated from the app (EagleDocs: a sandboxed frame with no network), so the
 * page can run its own scripts but never reach the user's data.
 */
export const showHtml = defineTool<{ title: string; html: string }>({
  name: 'show_html',
  description:
    'Show an interactive HTML page right inside the chat, to explain something visually: a simulation, an animated ' +
    'flow or process, a math function with sliders, an algorithm step by step, a small calculator or quiz. The user ' +
    'sees and uses it in the conversation; nothing to download.\n' +
    'How to write it:\n' +
    '- One complete, self-contained HTML document: CSS in <style>, JavaScript in <script>, no external files, CDNs, ' +
    'fonts or images from the web (the page has no network: they would not load). Draw with <canvas>, inline SVG or ' +
    'plain HTML.\n' +
    '- Make it work at about 700 px wide and up to ~600 px tall; it sits on a white background. Use readable font ' +
    'sizes and clear labels; put the controls near what they change.\n' +
    '- Keep it small and correct: test the math in your head, avoid infinite loops, and start in a meaningful state.\n' +
    '- Forms, pop-ups, storage and links that navigate do not work there; keep everything in the page.\n' +
    'After calling it, say in a sentence or two what the page shows and how to use it. Do not use it for plain text, ' +
    'tables or code the user should copy (write those in your answer), or for files to keep (use files_write).',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'A short title shown above the page, e.g. "Projectile motion"' },
      html: { type: 'string', description: `The complete HTML document, up to ${MAX_HTML_CHARS / 1000} KB` },
    },
    required: ['title', 'html'],
  },
  sideEffect: 'none',
  mainAgentOnly: true,
  // The page itself is in RunResult.displays: the card only needs its title.
  view: (args) => ({ title: args.title }),
  async run(args, ctx) {
    if (!ctx.display) throw new Error('Pages cannot be shown here: explain it in text instead');
    const title = String(args.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Interactive example';
    const html = String(args.html ?? '');
    if (!/<[a-z!]/i.test(html)) throw new Error('html must be an HTML document');
    if (html.length > MAX_HTML_CHARS) throw new Error(`The page is too big (${Math.round(html.length / 1000)} KB, max ${MAX_HTML_CHARS / 1000} KB): simplify it`);
    ctx.display({ kind: 'html', title, content: html });
    return { shown: title, note: 'The user sees it in the chat now. Explain briefly what it shows and how to use it.' };
  },
});

export const DISPLAY_TOOLS: Tool[] = [showHtml];
