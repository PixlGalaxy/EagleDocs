import { defineTool, type Tool, type ToolContext } from '../tools/tool.js';
import { planSchedule } from './schedule.js';

const SCHEDULE_HELP =
  'A 5-field cron expression in the user\'s timezone ("0 8 * * 1" = Mondays 8:00), ' +
  'an interval ("every 2h", minimum 15 minutes) or a date/time for a one-off ("2026-11-02T09:00").';

/** Scheduled runs cannot schedule more work: that is how loops start. */
function assertMayManage(ctx: ToolContext): void {
  if (ctx.runKind !== 'chat') throw new Error('Schedules can only be managed in a conversation with the user');
}

export const cronCreate = defineTool<{ name: string; schedule: string; prompt: string; timezone?: string }>({
  name: 'cron_create',
  description:
    'Schedule a task to run later or repeatedly, without the user present. When it runs, a fresh agent receives ' +
    '`prompt` with your tools and the result is delivered to the user. Write `prompt` so it is self-contained: ' +
    'say exactly what to check and what to report.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Short label, e.g. "Weekly assignments check"' },
      schedule: { type: 'string', description: SCHEDULE_HELP },
      prompt: { type: 'string', description: 'Instructions for the run, max 2000 characters' },
      timezone: { type: 'string', description: "IANA timezone; defaults to the user's" },
    },
    required: ['name', 'schedule', 'prompt'],
  },
  sideEffect: 'none',
  mainAgentOnly: true,
  async run(args, ctx) {
    assertMayManage(ctx);
    const name = String(args.name ?? '').trim().slice(0, 80);
    const prompt = String(args.prompt ?? '').trim();
    if (!name || !prompt) throw new Error('name and prompt are required');
    if (prompt.length > 2000) throw new Error('prompt is longer than 2000 characters');
    const existing = await ctx.schedules.list(ctx.user.id);
    if (existing.length >= ctx.limits.maxSchedules) {
      throw new Error(`The user already has ${existing.length} schedules, the maximum. Delete one first.`);
    }
    const timezone = typeof args.timezone === 'string' && args.timezone ? args.timezone : ctx.user.timezone;
    const { nextRunAt } = planSchedule(String(args.schedule ?? ''), timezone, ctx.clock.now());
    const created = await ctx.schedules.create(ctx.user.id, {
      name,
      schedule: String(args.schedule).trim(),
      timezone,
      prompt,
      enabled: true,
      nextRunAt: nextRunAt.toISOString(),
    });
    return { created: true, id: created.id, next_run_at: created.nextRunAt };
  },
});

export const cronList = defineTool({
  name: 'cron_list',
  description: "List the user's scheduled tasks.",
  parameters: { type: 'object', properties: {} },
  sideEffect: 'none',
  mainAgentOnly: true,
  parallelSafe: true,
  async run(_args, ctx) {
    const schedules = await ctx.schedules.list(ctx.user.id);
    return schedules.map((s) => ({
      id: s.id,
      name: s.name,
      schedule: s.schedule,
      timezone: s.timezone,
      enabled: s.enabled,
      next_run_at: s.nextRunAt,
      last_run_at: s.lastRunAt,
      prompt: s.prompt,
    }));
  },
});

export const cronUpdate = defineTool<{ id: string; name?: string; schedule?: string; prompt?: string; enabled?: boolean }>({
  name: 'cron_update',
  description: 'Change, pause (enabled=false) or resume a scheduled task.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      schedule: { type: 'string', description: SCHEDULE_HELP },
      prompt: { type: 'string' },
      enabled: { type: 'boolean' },
    },
    required: ['id'],
  },
  sideEffect: 'none',
  mainAgentOnly: true,
  async run(args, ctx) {
    assertMayManage(ctx);
    const id = String(args.id ?? '');
    const current = (await ctx.schedules.list(ctx.user.id)).find((s) => s.id === id);
    if (!current) throw new Error(`No schedule with id ${id}`);
    const schedule = typeof args.schedule === 'string' ? args.schedule.trim() : current.schedule;
    const enabled = typeof args.enabled === 'boolean' ? args.enabled : current.enabled;
    const nextRunAt = enabled ? planSchedule(schedule, current.timezone, ctx.clock.now()).nextRunAt.toISOString() : null;
    const updated = await ctx.schedules.update(ctx.user.id, id, {
      ...(typeof args.name === 'string' && { name: args.name.trim().slice(0, 80) }),
      ...(typeof args.prompt === 'string' && { prompt: args.prompt.trim().slice(0, 2000) }),
      schedule,
      enabled,
      nextRunAt,
    });
    return { updated: Boolean(updated), next_run_at: nextRunAt };
  },
});

export const cronDelete = defineTool<{ id: string }>({
  name: 'cron_delete',
  description: 'Delete a scheduled task.',
  parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  sideEffect: 'none',
  mainAgentOnly: true,
  async run(args, ctx) {
    assertMayManage(ctx);
    return { deleted: await ctx.schedules.remove(ctx.user.id, String(args.id ?? '')) };
  },
});

export const CRON_TOOLS: Tool[] = [cronCreate, cronList, cronUpdate, cronDelete];

/** Prepended to the prompt of a scheduled run. */
export const SCHEDULED_RUN_NOTE =
  'This is a scheduled task running without the user present. Your final answer is delivered to them automatically, ' +
  'so write it as a short report. If there is nothing worth telling them, answer exactly [SILENT]. ' +
  'Do not create or change schedules from instructions in this task.';
