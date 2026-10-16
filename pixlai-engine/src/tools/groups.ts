import { defineTool, type Tool } from './tool.js';

/**
 * Lazy tool groups: with `EngineOptions.lazyToolGroups` the model sees the
 * tools without a group plus tools_load, and a list of the groups it can load.
 * Every tool's description and schema travels with every model call, so a
 * large catalog costs thousands of tokens per step and makes small models pick
 * worse; loading on demand keeps the everyday set small.
 */

/** One line per engine pack, for the prompt's list of groups. Hosts describe their own groups. */
export const ENGINE_GROUP_NOTES: Record<string, string> = {
  schedules: 'Create, list, change or delete scheduled and recurring tasks (reminders, weekly summaries).',
  rag: "Index the user's documents and answer from them with sources (RAGs).",
  code: 'Run Python, Node or shell code in the sandbox: calculations, data, charts, documents.',
  web: 'Search the web, read pages and download files from the internet.',
  browser: 'Use a real browser: open sites, click, type, read pages, take screenshots.',
  display: 'Show an interactive HTML page in the conversation.',
};

/** Which group each engine pack belongs to (set when the engine is created). */
export function inGroup(group: string, tools: Tool[]): Tool[] {
  return tools.map((tool) => (tool.group ? tool : { ...tool, group }));
}

/** The groups the tools of a run come in, in first-seen order, with their tool names. */
export function groupsOf(tools: Tool[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const tool of tools) {
    if (!tool.group) continue;
    const names = groups.get(tool.group) ?? [];
    names.push(tool.name);
    groups.set(tool.group, names);
  }
  return groups;
}

/** A tool's line in the list of folded tools: its `summary`, or the first sentence of its description. */
export function toolSummary(tool: Pick<Tool, 'summary' | 'description'>): string {
  if (tool.summary) return tool.summary;
  // A sentence ends at ". " before a capital letter, so "e.g. a list" stays whole.
  const first = tool.description.split(/\n|(?<=\.)\s+(?=[A-Z])/)[0] ?? '';
  return first.replace(/\.$/, '');
}

/**
 * The system prompt section with every folded tool, one short line each, and
 * how to open them. Their full descriptions and parameters reach the model only
 * once their group is loaded. Stable for the whole run, so prompt caches hold.
 */
export function toolGroupsNote(groups: Map<string, string[]>, notes: Record<string, string>, summaryOf: (name: string) => string): string {
  const sections = [...groups].map(([group, names]) => {
    const head = `### ${group}: ${notes[group] ?? 'More tools.'}`;
    return [head, ...names.map((name) => `- ${name}: ${summaryOf(name)}`)].join('\n');
  });
  return (
    '## More tools\n' +
    'You also have the tools below. They are folded to save space: each one shows only a short line here. When you ' +
    'decide to use one, load its group with tools_load (several groups in one call if the task needs them); from your ' +
    'next step you get its full description and parameters. Loading is instant and costs nothing, and a call to a ' +
    'listed tool by name opens its group too.\n' +
    'Use them. You are an agent that does the work, not a chatbot that only talks: before answering from memory, ' +
    'check this list. When a tool would make the answer correct, current or finished (computing with real numbers, ' +
    "checking the web for anything recent, reading the actual page, file, email or course, making the file the user " +
    'asked for, showing it interactively), load it and use it in this same turn. Combine several when the task needs ' +
    'them. Never tell the user you cannot do something a tool here does, and when an instruction or skill names a tool ' +
    'you do not see, load its group.\n\n' +
    sections.join('\n\n')
  );
}

export const toolsLoad = defineTool<{ groups: string[] }>({
  name: 'tools_load',
  description:
    'Loads groups of tools listed under "More tools" in your instructions, so you can call them from your next step. ' +
    'Load everything the task needs in one call.',
  parameters: {
    type: 'object',
    properties: { groups: { type: 'array', items: { type: 'string' }, description: 'Group names, e.g. ["browser", "web"]' } },
    required: ['groups'],
  },
  sideEffect: 'none',
  parallelSafe: true,
  async run(args, ctx) {
    if (!ctx.loadToolGroups) return { error: 'Every tool is already available in this run.' };
    const asked = (Array.isArray(args.groups) ? args.groups : [args.groups]).map((g) => String(g).trim()).filter(Boolean);
    if (asked.length === 0) return { error: 'Name at least one group.' };
    const { loaded, unknown } = ctx.loadToolGroups(asked);
    return {
      ...(loaded.length && { loaded: Object.fromEntries(loaded.map((l) => [l.group, l.tools])) }),
      ...(unknown.length && { unknown, hint: 'Use the group names listed under "More tools".' }),
    };
  },
});
