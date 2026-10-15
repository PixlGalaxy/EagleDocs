import type { MemoryDoc, MemoryDocs } from '../ports.js';
import type { Limits } from '../types.js';
import { defineTool } from './tool.js';

/** Entries in USER.md and MEMORY.md are separated by this line, as in Hermes. */
export const ENTRY_SEPARATOR = '\n§\n';

export const DOC_FILES: Record<MemoryDoc, string> = { soul: 'SOUL.md', user: 'USER.md', notes: 'MEMORY.md' };

export function entriesOf(text: string): string[] {
  return text
    .split(/\n?§\n?/)
    .map((e) => e.trim())
    .filter(Boolean);
}

export function docLimit(doc: MemoryDoc, limits: Limits): number {
  return doc === 'soul' ? limits.soulChars : doc === 'user' ? limits.userChars : limits.notesChars;
}

interface Operation {
  action: 'add' | 'patch' | 'remove' | 'replace';
  content?: string;
  old_text?: string;
}

/**
 * Applies operations to one document. add/patch/remove work on entries
 * (USER.md, MEMORY.md); replace swaps the whole text (the only way to change
 * SOUL.md, which is prose). The limit is checked on the final result, so one
 * call can free room and add in the same batch.
 */
export function applyOperations(doc: MemoryDoc, current: string, operations: Operation[], limit: number): string {
  if (operations.length === 0) throw new Error('No operations');
  let text = current;
  for (const op of operations) {
    const content = String(op.content ?? '').trim();
    if (op.action === 'replace') {
      text = content;
      continue;
    }
    if (doc === 'soul') throw new Error('SOUL.md is prose: use action "replace" with the whole new text');
    const entries = entriesOf(text);
    const oldText = String(op.old_text ?? '').trim();
    if (op.action === 'add') {
      if (!content) throw new Error('add needs content');
      if (content.includes('§')) throw new Error('One entry per add (no § inside)');
      if (entries.some((e) => e.toLowerCase() === content.toLowerCase())) continue;
      entries.push(content);
    } else {
      if (!oldText) throw new Error(`${op.action} needs old_text from one entry`);
      const matches = entries.filter((e) => e.includes(oldText));
      if (matches.length === 0) throw new Error(`No entry contains "${oldText.slice(0, 80)}"`);
      if (matches.length > 1) throw new Error(`"${oldText.slice(0, 80)}" is in ${matches.length} entries: quote more of the one you mean`);
      const index = entries.indexOf(matches[0]!);
      if (op.action === 'remove') entries.splice(index, 1);
      else if (op.action === 'patch') {
        if (!content) throw new Error('patch needs content (the replacement for old_text)');
        entries[index] = entries[index]!.replace(oldText, content);
      } else throw new Error(`Unknown action "${String(op.action)}"`);
    }
    text = entries.join(ENTRY_SEPARATOR);
  }
  if (text.length > limit) {
    throw new Error(
      `${DOC_FILES[doc]} would have ${text.length} of ${limit} characters. In the same call, remove or shorten entries ` +
        'that are stale or less useful, then add the new one.',
    );
  }
  return text;
}

/** One line per document: how full it is, so the agent knows when to consolidate. */
export function usageLine(docs: MemoryDocs, limits: Limits): string {
  return (['user', 'notes', 'soul'] as const).map((d) => `${DOC_FILES[d]} ${docs[d].length}/${docLimit(d, limits)}`).join(', ');
}

export const memoryUpdate = defineTool<{ target: MemoryDoc; operations?: Operation[]; action?: Operation['action']; content?: string; old_text?: string }>({
  name: 'memory_update',
  description:
    'Edit your persistent files, which are in your instructions every conversation:\n' +
    '- USER.md (target "user"): who the user is: name, studies, goals, schedule, preferences, how they like answers.\n' +
    '- MEMORY.md (target "notes"): your own notes: standing conventions, what works with their accounts and tools, lessons.\n' +
    '- SOUL.md (target "soul"): your personality and tone. Change it only when the user asks you to be different.\n' +
    'Make all changes to one file in ONE call with "operations" (each {action, content?, old_text?}): add a new entry, ' +
    'patch (replace old_text inside one entry with content), remove (the entry containing old_text), or replace (the ' +
    'whole file, for SOUL.md). The size limit is checked on the result, so remove stale entries and add in the same call.\n' +
    'Save only what will matter in future conversations. Skip one-off details, task progress, and anything secret ' +
    '(passwords, codes, tokens). Lessons about one kind of task go to that skill with skills_note instead.',
  parameters: {
    type: 'object',
    properties: {
      target: { type: 'string', enum: ['user', 'notes', 'soul'], description: 'user = USER.md, notes = MEMORY.md, soul = SOUL.md' },
      operations: {
        type: 'array',
        description: 'Changes applied together',
        items: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['add', 'patch', 'remove', 'replace'] },
            content: { type: 'string', description: 'New entry (add), replacement text (patch), or whole file (replace)' },
            old_text: { type: 'string', description: 'Text from one existing entry (patch, remove)' },
          },
          required: ['action'],
        },
      },
      action: { type: 'string', enum: ['add', 'patch', 'remove', 'replace'], description: 'Single change instead of operations' },
      content: { type: 'string' },
      old_text: { type: 'string' },
    },
    required: ['target'],
  },
  sideEffect: 'none',
  mainAgentOnly: true,
  async run(args, ctx) {
    const target = args.target;
    if (!['user', 'notes', 'soul'].includes(target)) throw new Error('target must be user, notes or soul');
    const operations: Operation[] = Array.isArray(args.operations) && args.operations.length
      ? args.operations
      : args.action
        ? [{ action: args.action, content: args.content, old_text: args.old_text }]
        : [];
    const docs = await ctx.memory.read(ctx.user.id);
    const next = applyOperations(target, docs[target], operations, docLimit(target, ctx.limits));
    if (next !== docs[target]) await ctx.memory.write(ctx.user.id, target, next);
    return { saved: true, file: DOC_FILES[target], usage: usageLine({ ...docs, [target]: next }, ctx.limits) };
  },
});
