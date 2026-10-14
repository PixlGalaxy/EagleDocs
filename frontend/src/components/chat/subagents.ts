import type { StreamEvent, SubagentProgress, ToolCall } from '../../api/types';

type SubagentEvent = Extract<StreamEvent, { type: 'subagent' }>;

/** Folds one `subagent` event into the helpers' progress (helpers of helpers count as their parent's steps). */
export function applySubagentEvent(list: SubagentProgress[], event: SubagentEvent): SubagentProgress[] {
  const current = list.find((s) => s.index === event.index) ?? { index: event.index, task: event.task, status: 'running' as const, steps: [] };
  let inner = event.event;
  const nested = inner.type === 'subagent';
  while (inner.type === 'subagent') inner = inner.event;

  let next: SubagentProgress = current;
  if (inner.type === 'tool_call' || inner.type === 'tool_result') {
    const call: ToolCall = inner.call;
    next = { ...current, steps: [...current.steps.filter((step) => step.id !== call.id), call] };
  } else if (inner.type === 'status' && !nested) {
    const status = inner.status === 'done' || inner.status === 'failed' || inner.status === 'cancelled' ? inner.status : 'running';
    next = { ...current, status };
  }
  if (next === current && list.includes(current)) return list;
  return [...list.filter((s) => s.index !== event.index), next].sort((a, b) => a.index - b.index);
}

/** A tool result replaces the call: keep the helpers' progress that came with it. */
export function mergeCall(previous: ToolCall | undefined, call: ToolCall): ToolCall {
  return previous?.subagents ? { ...call, subagents: previous.subagents } : call;
}
