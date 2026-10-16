import type { PlanStep, UserQuestion } from '../types.js';
import { evaluate } from './calc.js';
import { defineTool, type Tool } from './tool.js';

const STATUSES: PlanStep['status'][] = ['pending', 'in_progress', 'done', 'skipped'];

/** A visible checklist for multi-step work; hosts render it from the `plan` event. */
export const planUpdate = defineTool<{ title?: string; steps: { title: string; status?: string }[] }>({
  name: 'plan_update',
  summary: 'show the user a live checklist of your plan and tick it off as you work',
  description:
    'Shows the user a live checklist of your plan, right above the message box, and updates it as you work. Use it often: ' +
    'it is how the user sees what you are doing and how far along you are.\n' +
    'When: every task that takes 3 or more steps. Examples: a project or app, an assignment or essay, a study plan, code ' +
    'with several files, research that needs several searches, a document or spreadsheet, anything with tools in a row. ' +
    'Skip it only for a quick answer or a single tool call.\n' +
    'How:\n' +
    '- Call it before you start the work, with every step as pending and the first one in_progress.\n' +
    '- Call it again each time a step is finished (done) and the next one starts (in_progress). Send the full list every ' +
    'time; mark a step you drop as skipped, and add steps if the work grows.\n' +
    '- Steps are short and concrete (what you will do, e.g. "Read the assignment in Canvas", "Write the Flask routes", ' +
    '"Test the app"), 3 to 8 of them. The title names the task, e.g. "Chapter 7 homework".\n' +
    '- Finish with every step done (or skipped) before your final answer.\n' +
    'Writing a plan as a list in your message is not the same: the user only sees the checklist from this tool.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'A short name for the plan, e.g. "Chapter 7 homework" (max 60 characters)' },
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
    const title = String(args.title ?? '').trim().slice(0, 60);
    ctx.emit({ type: 'plan', ...(title && { title }), steps });
    return { shown: true, steps: steps.length };
  },
});

const MAX_QUESTIONS = 4;

/** Clean, bounded text from a model argument. */
const clip = (value: unknown, max: number): string => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Checks the questions the model wrote; throws a message it can fix. */
function questionsFrom(raw: unknown): UserQuestion[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new Error('questions must be a list of 1 to 4 questions');
  if (raw.length > MAX_QUESTIONS) throw new Error(`Ask at most ${MAX_QUESTIONS} questions at once`);
  return raw.map((q, i) => {
    const item = (q ?? {}) as { question?: unknown; header?: unknown; options?: unknown; multi_select?: unknown };
    const question = clip(item.question, 300);
    if (!question) throw new Error(`Question ${i + 1} has no text`);
    const options = (Array.isArray(item.options) ? item.options : [])
      .map((o) => ({ label: clip((o as { label?: unknown })?.label, 60), description: clip((o as { description?: unknown })?.description, 200) }))
      .filter((o) => o.label)
      .map((o) => (o.description ? o : { label: o.label }));
    if (options.length < 2 || options.length > 4) throw new Error(`Question ${i + 1} needs 2 to 4 options (the user can always write their own answer)`);
    if (new Set(options.map((o) => o.label.toLowerCase())).size !== options.length) throw new Error(`Question ${i + 1} repeats an option`);
    const header = clip(item.header, 24);
    return { question, ...(header && { header }), options, ...(item.multi_select === true && { multiSelect: true }) };
  });
}

/** The questions as plain text: the answer the conversation keeps, for clients that cannot show choices. */
export function questionsAsText(questions: UserQuestion[]): string {
  const lines = [questions.length === 1 ? 'Before I continue, one question:' : 'Before I continue, a few questions:', ''];
  questions.forEach((q, i) => {
    lines.push(`${questions.length > 1 ? `${i + 1}. ` : ''}${q.header ? `**${q.header}:** ` : ''}${q.question}${q.multiSelect ? ' (pick any)' : ''}`);
    for (const o of q.options) lines.push(`   - ${o.label}${o.description ? `: ${o.description}` : ''}`);
  });
  return lines.join('\n');
}

/**
 * Ends the turn with questions when the agent cannot go on without the user.
 * With options, hosts show them as choices; the answers arrive as the next message.
 */
export const askUser = defineTool<{ question?: string; questions?: unknown }>({
  name: 'ask_user',
  summary: 'ask the user questions with clickable options (the only way to ask anything)',
  description:
    'Asks the user questions they answer by clicking options in a card, and ends your turn; their answers arrive as their ' +
    'next message. This is the only way to ask the user something: never write questions or lists of choices in your ' +
    'message, because there they are plain text the user cannot click. Use it often, whenever their answer would change ' +
    'what you do.\n' +
    'When:\n' +
    '- Before starting a project, plan, essay, app or study plan whose key choices the user did not give (type, scope, ' +
    'level, format, length, deadline, tools, style).\n' +
    '- When the user says "ask me if you have questions", or the request is ambiguous enough that you would otherwise guess.\n' +
    '- A real choice between approaches, a preference only they know, or a detail you cannot find with your tools.\n' +
    '- When you reach a point where you need their decision to go on.\n' +
    'Before asking, look up what you can yourself (their courses, files, the web), and you may show a plan_update first.\n' +
    'How to ask well:\n' +
    '- Ask everything you need at once (1 to 4 questions), not one question per turn.\n' +
    '- Give each question 2 to 4 options that are clearly different. Labels are short (1-5 words); the description says ' +
    'what choosing it means or its trade-off.\n' +
    '- Put the option you recommend first and add " (Recommended)" to its label.\n' +
    '- Never add an "Other" option: the user can always write their own answer.\n' +
    '- Set multi_select when several options can be picked together (e.g. which topics to include).\n' +
    '- header is a 1-3 word tag for the question, e.g. "Format" or "Due date".\n' +
    'Do not ask: things you can look up (their courses, files, the web), to confirm a step you can simply take, or ' +
    '"anything else?". If you only need a short free answer (a name, a number), pass `question` instead of `questions`.',
  parameters: {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        description: `1 to ${MAX_QUESTIONS} questions, each with options`,
        items: {
          type: 'object',
          properties: {
            question: { type: 'string', description: 'The full question, ending with "?"' },
            header: { type: 'string', description: 'A 1-3 word tag, e.g. "Format"' },
            options: {
              type: 'array',
              description: '2 to 4 options; the recommended one first',
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string', description: '1-5 words' },
                  description: { type: 'string', description: 'What choosing it means, or its trade-off' },
                },
                required: ['label'],
              },
            },
            multi_select: { type: 'boolean', description: 'The user may pick several options' },
          },
          required: ['question', 'options'],
        },
      },
      question: { type: 'string', description: 'Instead of questions: one question answered in free text, with no options' },
    },
  },
  sideEffect: 'none',
  mainAgentOnly: true,
  async run(args, ctx) {
    if (!ctx.askUser || ctx.runKind !== 'chat') throw new Error('Nobody can answer here: decide with the information you have');
    if (args.questions !== undefined) {
      const questions = questionsFrom(args.questions);
      ctx.askUser(questionsAsText(questions), questions);
      return { asked: questions.length, note: 'Your turn ends now; the answers come as the next message.' };
    }
    const question = String(args.question ?? '').trim();
    if (!question) throw new Error('Pass questions (with options) or question');
    ctx.askUser(question.slice(0, 2000));
    return { asked: 1 };
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
