import type { PlanStep } from '../types.js';
import { evaluate } from './calc.js';
import { defineTool, type Tool } from './tool.js';

const STATUSES: PlanStep['status'][] = ['pending', 'in_progress', 'done', 'skipped'];

/** A visible checklist for multi-step work; hosts render it from the `plan` event. */
export const planUpdate = defineTool<{ steps: { title: string; status?: string }[] }>({
  name: 'plan_update',
  description:
    'Show the user your plan for a task with several steps, and keep it updated as you work (send the full list each time). ' +
    'Use it for work that takes 3 or more steps; skip it for quick answers.',
  parameters: {
    type: 'object',
    properties: {
      steps: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Short step, max 100 characters' },
            status: { type: 'string', enum: STATUSES },
          },
          required: ['title'],
        },
      },
    },
    required: ['steps'],
  },
  sideEffect: 'none',
  async run(args, ctx) {
    const raw = Array.isArray(args.steps) ? args.steps : [];
    if (raw.length === 0 || raw.length > 20) throw new Error('Give between 1 and 20 steps');
    const steps: PlanStep[] = raw.map((s) => ({
      title: String(s?.title ?? '').slice(0, 100) || 'Step',
      status: STATUSES.includes(s?.status as PlanStep['status']) ? (s.status as PlanStep['status']) : 'pending',
    }));
    ctx.emit({ type: 'plan', steps });
    return { shown: true, steps: steps.length };
  },
});

/**
 * Ends the turn with a question when the agent cannot continue without the
 * user (missing detail, real ambiguity). The run finishes; the reply starts a new one.
 */
export const askUser = defineTool<{ question: string }>({
  name: 'ask_user',
  description:
    'Ask the user something you need before you can continue (a missing detail or a real choice between options). ' +
    'Your turn ends and the question is shown as your answer. Do not use it for things you can find with your tools.',
  parameters: {
    type: 'object',
    properties: { question: { type: 'string', description: 'One clear question; list options if there are any' } },
    required: ['question'],
  },
  sideEffect: 'none',
  mainAgentOnly: true,
  async run(args, ctx) {
    const question = String(args.question ?? '').trim();
    if (!question) throw new Error('question is empty');
    if (!ctx.askUser || ctx.runKind !== 'chat') throw new Error('Nobody can answer here: decide with the information you have');
    ctx.askUser(question.slice(0, 2000));
    return { asked: true };
  },
});

/** A heads-up that should reach the user even if they left (hosts may send it as a push notification). */
export const notify = defineTool<{ title: string; body: string; url?: string }>({
  name: 'notify',
  description:
    'Send the user a short notification (it may arrive as a push notification on their phone). Use it for things that ' +
    'need attention when they are not looking at the chat, like the result of a scheduled task. Not for normal answers.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Max 60 characters' },
      body: { type: 'string', description: 'Max 200 characters' },
      url: { type: 'string', description: 'Optional link to open' },
    },
    required: ['title', 'body'],
  },
  sideEffect: 'none',
  mainAgentOnly: true,
  async run(args, ctx) {
    const title = String(args.title ?? '').trim().slice(0, 60);
    const body = String(args.body ?? '').trim().slice(0, 200);
    if (!title || !body) throw new Error('title and body are required');
    const url = typeof args.url === 'string' && /^https?:\/\//.test(args.url) ? args.url : undefined;
    ctx.emit({ type: 'notify', title, body, ...(url && { url }) });
    return { sent: true };
  },
});

/** Exact arithmetic: models are bad at it, and numbers the user relies on need to be right. */
export const calc = defineTool<{ expression: string }>({
  name: 'calc',
  description:
    'Evaluate an arithmetic expression exactly. Supports + - * / % ^, parentheses, pi, e and sqrt, abs, round(x, digits), ' +
    'floor, ceil, min, max, sum, avg, log(x, base), ln, exp, pow, sin, cos, tan. Use it for totals, averages, percentages ' +
    'and any number you would otherwise compute in your head.',
  parameters: {
    type: 'object',
    properties: { expression: { type: 'string', description: 'e.g. "avg(88, 92.5, 79) * 0.4 + 95 * 0.6"' } },
    required: ['expression'],
  },
  sideEffect: 'none',
  parallelSafe: true,
  async run(args) {
    const expression = String(args.expression ?? '');
    return { expression, result: evaluate(expression) };
  },
});

export const CORE_TOOLS: Tool[] = [planUpdate, askUser, notify, calc];
