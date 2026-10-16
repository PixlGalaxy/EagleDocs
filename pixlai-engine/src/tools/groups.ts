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

/** The system prompt section listing the groups the agent can load. Stable for the whole run. */
export function toolGroupsNote(groups: Map<string, string[]>, notes: Record<string, string>): string {
  const lines = [...groups].map(([group, names]) => `- ${group}: ${notes[group] ?? 'More tools.'} (${names.join(', ')})`);
  return (
    '## More tools\n' +
    'Besides the tools you see, these groups are available. Load the ones a task needs with tools_load (several at once ' +
    'if needed) before using them; when an instruction or skill names a tool you do not see, load its group.\n' +
    lines.join('\n')
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
