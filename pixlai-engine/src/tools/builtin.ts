import { defineTool, type Tool } from './tool.js';
import { memoryUpdate } from './memory.js';

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
    // Lessons first: they are short, personal, and must survive any cut of a long skill.
    return { name: skill.name, lessons_learned: skill.notes, instructions: skill.body };
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

export const BUILTIN_TOOLS: Tool[] = [timeNow, memoryUpdate, skillsLoad, skillsNote];
