import { defineTool, type SubagentOutcome } from '../tools/tool.js';
import type { HelperModel } from '../types.js';

/** Characters of each subagent's answer handed back to the parent. */
export const SUBAGENT_SUMMARY_CHARS = 8000;

/** One piece of work for a helper agent. */
export interface DelegateTask {
  goal: string;
  context?: string;
  /** A ref or tag from the host's helper models (see `helperModelsNote`). */
  model?: string;
}

/** A helper's report, as the parent agent reads it. */
export interface DelegateReport {
  goal: string;
  status: SubagentOutcome['status'];
  summary: string;
  /** The model it ran on. */
  model?: string;
}

/** What a helper is told: the goal, plus the facts it needs from the conversation. */
export function taskBrief(task: DelegateTask): string {
  const goal = String(task?.goal ?? '').trim();
  return task?.context ? `${goal}\n\nContext:\n${String(task.context)}` : goal;
}

export function toReport(goal: string, outcome: SubagentOutcome): DelegateReport {
  const summary =
    outcome.summary.length > SUBAGENT_SUMMARY_CHARS ? `${outcome.summary.slice(0, SUBAGENT_SUMMARY_CHARS)}\n[report truncated]` : outcome.summary;
  return { goal, status: outcome.status, summary, ...(outcome.model && { model: outcome.model }) };
}

/** The prompt section that lets the main agent pick a model per helper. */
export function helperModelsNote(models: HelperModel[]): string {
  const list = models.slice(0, 30).map((m) => `- \`${m.ref}\`: ${m.label}${m.tags.length ? ` [${m.tags.join(', ')}]` : ''}`);
  return (
    '## Models for helpers\n' +
    'Each agent_delegate task can set `model` to a ref below or to a tag (`fast`, `smart`, `code`). Match the model to ' +
    'the work: `fast` for simple lookups, reading a few items or short summaries; `smart` for multi-step reasoning, ' +
    'analysis, planning or careful writing; `code` for writing or fixing code. When unsure, or when a mistake would ' +
    'be costly, use `smart`. Leave it out to use your own model.\n' +
    list.join('\n')
  );
}

/**
 * The message that hands background reports to the main agent in a later turn.
 * Hosts store it as a user-role message; it says plainly it is not the user.
 */
export function backgroundReportMessage(reports: DelegateReport[]): string {
  const body = reports
    .map((r, i) => `### Helper ${i + 1} (${r.status}): ${r.goal.split('\n')[0]!.slice(0, 200)}\n${r.summary}`)
    .join('\n\n');
  return (
    '[Background helpers finished. This message is from the system, not the user: it carries the reports of the ' +
    'helpers you started earlier with agent_delegate. Answer the user now with what they found.]\n\n' +
    body
  );
}

/**
 * Hands independent pieces of work to subagents that run in parallel with a
 * fresh context and return a short report. They get read-only tools only:
 * no approvals, memory writes or schedules. With `background` (when the host
 * supports it) the run does not wait: the reports arrive in a later turn.
 */
export const agentDelegate = defineTool<{ tasks: DelegateTask[]; background?: boolean }>({
  name: 'agent_delegate',
  description:
    'Delegate independent subtasks to helper agents that work in parallel and report back. Use it for research ' +
    'or analysis that splits cleanly (e.g. one topic or source each). Each helper starts with no memory of this ' +
    'conversation, so put everything it needs in `goal` and `context`. Helpers cannot ask the user anything ' +
    'and cannot take actions that need approval.',
  parameters: {
    type: 'object',
    properties: {
      tasks: {
        type: 'array',
        description: 'One entry per helper',
        items: {
          type: 'object',
          properties: {
            goal: { type: 'string', description: 'What to find out or produce, and what to report' },
            context: { type: 'string', description: 'Facts from this conversation the helper needs' },
            model: { type: 'string', description: 'Model for this helper: a ref or tag from "Models for helpers" (omit for your own)' },
          },
          required: ['goal'],
        },
      },
      background: {
        type: 'boolean',
        description:
          'true for long work (many pages, files or sources) the user does not need in this answer: you reply ' +
          'right away and the reports arrive later as a new message you then answer. Default false: wait for them.',
      },
    },
    required: ['tasks'],
  },
  sideEffect: 'none',
  async run(args, ctx) {
    if (!ctx.spawnSubagent) throw new Error('Delegation is not available here');
    const tasks = Array.isArray(args.tasks) ? args.tasks : [];
    if (tasks.length === 0) throw new Error('tasks is empty');
    if (tasks.length > ctx.limits.maxParallelSubagents) {
      throw new Error(`At most ${ctx.limits.maxParallelSubagents} tasks at once`);
    }
    if (tasks.some((task) => !String(task?.goal ?? '').trim())) throw new Error('Every task needs a goal');

    if (args.background === true && ctx.startBackground) {
      await ctx.startBackground(
        tasks.map((task) => ({
          goal: String(task.goal).trim(),
          ...(task.context && { context: String(task.context) }),
          ...(task.model && { model: String(task.model) }),
        })),
      );
      return {
        started: tasks.length,
        note:
          'The helpers are working in the background. Tell the user in a sentence or two what you started and that ' +
          'you will report back when they finish. Do not wait for them or delegate the same tasks again.',
      };
    }

    return Promise.all(
      tasks.map(async (task, index) => {
        const goal = String(task.goal).trim();
        return toReport(goal, await ctx.spawnSubagent!(taskBrief(task), index, task.model ? String(task.model) : undefined));
      }),
    );
  },
});

export const SUBAGENT_PROMPT =
  'You are a focused helper agent working on one task for the main assistant, not talking to the user directly. ' +
  'Use your tools as needed, then answer with a tight report: the outcome first, then key findings as bullets, ' +
  'then anything you could not do. No greetings, no questions back.';
