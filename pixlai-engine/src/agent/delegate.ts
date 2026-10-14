import { defineTool } from '../tools/tool.js';

/** Characters of each subagent's answer handed back to the parent. */
export const SUBAGENT_SUMMARY_CHARS = 8000;

/**
 * Hands independent pieces of work to subagents that run in parallel with a
 * fresh context and return a short report. They get read-only tools only:
 * no approvals, memory writes or schedules.
 */
export const agentDelegate = defineTool<{ tasks: { goal: string; context?: string }[] }>({
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
          },
          required: ['goal'],
        },
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
    const results = await Promise.all(
      tasks.map(async (task, index) => {
        const goal = String(task?.goal ?? '').trim();
        if (!goal) return { goal, status: 'failed', summary: 'Empty goal' };
        const brief = task.context ? `${goal}\n\nContext:\n${String(task.context)}` : goal;
        const outcome = await ctx.spawnSubagent!(brief, index);
        const summary =
          outcome.summary.length > SUBAGENT_SUMMARY_CHARS
            ? `${outcome.summary.slice(0, SUBAGENT_SUMMARY_CHARS)}\n[report truncated]`
            : outcome.summary;
        return { goal, status: outcome.status, summary };
      }),
    );
    return results;
  },
});

export const SUBAGENT_PROMPT =
  'You are a focused helper agent working on one task for the main assistant, not talking to the user directly. ' +
  'Use your tools as needed, then answer with a tight report: the outcome first, then key findings as bullets, ' +
  'then anything you could not do. No greetings, no questions back.';
