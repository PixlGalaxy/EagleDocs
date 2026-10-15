import { useState } from 'react';
import { Bot, Check, ChevronRight, CircleAlert, Hourglass, Loader2, Ban } from 'lucide-react';
import type { SubagentProgress, ToolCall } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import { labelFor } from './toolLabels';

// shrink-0: a long tool or task name must not squeeze the icon.
const STATUS_ICON = {
  running: <Loader2 size={14} className="shrink-0 animate-spin text-[var(--accent-500)] motion-reduce:animate-none" />,
  done: <Check size={14} className="shrink-0 text-emerald-500" />,
  error: <CircleAlert size={14} className="shrink-0 text-rose-500" />,
  waiting_approval: <Hourglass size={14} className="shrink-0 text-amber-500" />,
  rejected: <Ban size={14} className="shrink-0 text-slate-400" />,
} as const;

const SUBAGENT_ICON = {
  running: STATUS_ICON.running,
  done: STATUS_ICON.done,
  failed: STATUS_ICON.error,
  cancelled: STATUS_ICON.rejected,
} as const;

/** What each helper agent is doing: its task, its state and the step it is on. */
export const SubagentList = ({ subagents }: { subagents: SubagentProgress[] }) => {
  const { t } = useI18n();
  return (
    <ul className="ml-7 mt-1 space-y-1.5 border-l border-slate-200 pl-3 dark:border-slate-700">
      {subagents.map((agent) => {
        const last = agent.steps.at(-1);
        const lastLabel = last && labelFor(last.name);
        return (
          <li key={agent.index} className="text-xs text-slate-600 dark:text-slate-400">
            <p className="flex min-w-0 items-center gap-1.5">
              {SUBAGENT_ICON[agent.status]}
              <Bot size={13} className="shrink-0 text-slate-400" aria-hidden="true" />
              <span className="min-w-0 truncate font-medium text-slate-700 dark:text-slate-300">{agent.task}</span>
              {agent.model && <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">{agent.model}</span>}
            </p>
            {agent.steps.length > 0 && (
              <p className="ml-[22px] truncate text-slate-500">
                {t('tools.subagentSteps', { count: agent.steps.length })}
                {last && agent.status === 'running' && <> · {lastLabel ? t(lastLabel) : last.name}</>}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
};

/** Compact trace of what the agent did, expandable per call. */
const ToolCallList = ({ calls }: { calls: ToolCall[] }) => {
  const { t } = useI18n();
  const [open, setOpen] = useState<string | null>(null);

  if (!calls.length) return null;

  return (
    // No gap under the list when nothing follows it (a turn that only ran tools).
    <ul className="mb-3 space-y-1 last:mb-0">
      {calls.map((call) => {
        const labelKey = labelFor(call.name);
        const expanded = open === call.id;
        return (
          <li key={call.id} className="text-sm">
            <button
              type="button"
              onClick={() => setOpen(expanded ? null : call.id)}
              aria-expanded={expanded}
              className="flex max-w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-slate-600 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              {STATUS_ICON[call.status]}
              <span className="min-w-0 truncate">{labelKey ? t(labelKey) : call.name}</span>
              <ChevronRight size={14} className={`shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`} aria-hidden="true" />
            </button>
            {call.subagents && call.subagents.length > 0 && <SubagentList subagents={call.subagents} />}
            {expanded && (
              <div className="ml-7 mt-1 min-w-0 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
                <p className="break-all">
                  <span className="text-slate-400">{call.name}</span> {JSON.stringify(call.args)}
                </p>
                {call.result_preview && <pre className="scroll-thin max-h-48 overflow-auto whitespace-pre-wrap break-words">{call.result_preview}</pre>}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
};

export default ToolCallList;
