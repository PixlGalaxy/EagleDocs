import { defineTool, type Tool } from './tool.js';

/** Wall clock in the user's timezone: models do not know what day it is. */
export const timeNow = defineTool<{ timezone?: string }>({
  name: 'time_now',
  description: "Current date and time. Uses the user's timezone unless another IANA timezone is given.",
  parameters: {
    type: 'object',
    properties: { timezone: { type: 'string', description: 'IANA timezone, e.g. America/New_York' } },
  },
  sideEffect: 'none',
  parallelSafe: true,
  async run(args, ctx) {
    const timeZone = typeof args.timezone === 'string' && args.timezone ? args.timezone : ctx.user.timezone;
    const now = ctx.clock.now();
    let local: string;
    try {
      local = new Intl.DateTimeFormat('en-US', { timeZone, dateStyle: 'full', timeStyle: 'long' }).format(now);
    } catch {
      throw new Error(`Unknown timezone "${timeZone}"`);
    }
    return { iso: now.toISOString(), timezone: timeZone, local };
  },
});

export const memoryAdd = defineTool<{ content: string }>({
  name: 'memory_add',
  description:
    'Save a durable fact about the user for future conversations (preferences, goals, recurring context). ' +
    'One fact per call, written in third person. Do not save secrets, passwords or one-off details.',
  parameters: {
    type: 'object',
    properties: { content: { type: 'string', description: 'The fact, max 500 characters' } },
    required: ['content'],
  },
  sideEffect: 'none',
  mainAgentOnly: true,
  async run(args, ctx) {
    const content = String(args.content ?? '').trim();
    if (!content) throw new Error('content is empty');
    if (content.length > 500) throw new Error('content is longer than 500 characters');
    const item = await ctx.memory.add(ctx.user.id, content, 'agent');
    return { saved: true, id: item.id };
  },
});

export const memorySearch = defineTool<{ query: string }>({
  name: 'memory_search',
  description: 'Search what you remember about the user.',
  parameters: {
    type: 'object',
    properties: { query: { type: 'string' } },
    required: ['query'],
  },
  sideEffect: 'none',
  parallelSafe: true,
  async run(args, ctx) {
    const items = await ctx.memory.search(ctx.user.id, String(args.query ?? ''), 10);
    return items.map((item) => ({ id: item.id, content: item.content, saved_at: item.createdAt }));
  },
});

export const memoryRemove = defineTool<{ id: string }>({
  name: 'memory_remove',
  description: 'Forget a saved fact that is wrong or outdated (use memory_search to find its id).',
  parameters: {
    type: 'object',
    properties: { id: { type: 'string' } },
    required: ['id'],
  },
  sideEffect: 'none',
  mainAgentOnly: true,
  async run(args, ctx) {
    return { removed: await ctx.memory.remove(ctx.user.id, String(args.id ?? '')) };
  },
});

export const skillsLoad = defineTool<{ slug: string }>({
  name: 'skills_load',
  description: 'Load the full instructions of one of your skills before doing a task it covers.',
  parameters: {
    type: 'object',
    properties: { slug: { type: 'string', description: 'Skill id from the skills list in your instructions' } },
    required: ['slug'],
  },
  sideEffect: 'none',
  parallelSafe: true,
  async run(args, ctx) {
    const skill = await ctx.skills.load(ctx.user.id, String(args.slug ?? ''));
    if (!skill) throw new Error(`No skill "${String(args.slug)}" is available`);
    return { name: skill.name, instructions: skill.body, lessons_learned: skill.notes };
  },
});

export const skillsNote = defineTool<{ slug: string; note: string }>({
  name: 'skills_note',
  description:
    'Record a short lesson learned while using a skill for this user (e.g. a better way to do a step). ' +
    'It is shown the next time the skill loads.',
  parameters: {
    type: 'object',
    properties: { slug: { type: 'string' }, note: { type: 'string', description: 'Max 300 characters' } },
    required: ['slug', 'note'],
  },
  sideEffect: 'none',
  mainAgentOnly: true,
  async run(args, ctx) {
    const note = String(args.note ?? '').trim();
    if (!note || note.length > 300) throw new Error('note must be 1 to 300 characters');
    await ctx.skills.addNote(ctx.user.id, String(args.slug ?? ''), note);
    return { saved: true };
  },
});

export const BUILTIN_TOOLS: Tool[] = [timeNow, memoryAdd, memorySearch, memoryRemove, skillsLoad, skillsNote];
