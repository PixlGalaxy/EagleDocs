import { useState } from 'react';
import { Bot, Check, CheckCheck, ChevronRight, CircleAlert, Hourglass, ListX, Loader2, Ban } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
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

/** The whole run at a glance: working, all fine (green), some failed (orange), all failed (red). */
function summaryIcon(calls: ToolCall[]) {
  if (calls.some((c) => c.status === 'running' || c.status === 'waiting_approval')) return STATUS_ICON.running;
  const failed = calls.filter((c) => c.status === 'error').length;
  if (failed === 0) return <CheckCheck size={14} className="shrink-0 text-emerald-500" aria-hidden="true" />;
  return <ListX size={14} className={`shrink-0 ${failed === calls.length ? 'text-rose-500' : 'text-orange-500'}`} aria-hidden="true" />;
}

/**
 * What the agent did. Compact (the student's default, Settings → Appearance):
 * one line, "8 tools · <the current or last one>", that opens into the list.
 * Full: every call listed. Each call expands to its arguments and result.
 */
const ToolCallList = ({ calls }: { calls: ToolCall[] }) => {
  const { t } = useI18n();
  const { user } = useAuth();
  const [open, setOpen] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);

  if (!calls.length) return null;

  const label = (call: ToolCall) => {
    // Helpers the agent waits for (shown here) and helpers sent to the background (their own card below) read differently.
    if (call.name === 'agent_delegate') return t(call.args.background === true ? 'tools.delegateBackground' : 'tools.delegateWait');
    const key = labelFor(call.name);
    return key ? t(key) : call.name;
  };
  const compact = (user?.tool_trace ?? 'compact') === 'compact' && calls.length > 1;
  if (compact && !listOpen) {
    const current = calls.find((c) => c.status === 'running' || c.status === 'waiting_approval') ?? calls.at(-1)!;
    // Helpers still working show their progress even while the list is closed.
    const working = calls.filter((c) => c.subagents?.some((a) => a.status === 'running'));
    return (
      <div className="mb-3 text-sm last:mb-0">
        <button
          type="button"
          onClick={() => setListOpen(true)}
          aria-expanded={false}
          className="flex max-w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-slate-600 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          {summaryIcon(calls)}
          <span className="shrink-0 font-medium text-slate-700 dark:text-slate-300">{t('tools.count', { count: calls.length })}</span>
          <span className="min-w-0 truncate">· {label(current)}</span>
          <ChevronRight size={14} className="shrink-0" aria-hidden="true" />
        </button>
        {working.map((call) => (
          <SubagentList key={call.id} subagents={call.subagents!} />
        ))}
      </div>
    );
  }

  return (
    // No gap under the list when nothing follows it (a turn that only ran tools).
    <ul className="mb-3 space-y-1 last:mb-0">
      {compact && (
        <li>
          <button
            type="button"
            onClick={() => setListOpen(false)}
            aria-expanded
            className="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm text-slate-600 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            {summaryIcon(calls)}
            <span className="font-medium text-slate-700 dark:text-slate-300">{t('tools.count', { count: calls.length })}</span>
            <ChevronRight size={14} className="shrink-0 rotate-90 transition-transform" aria-hidden="true" />
          </button>
        </li>
      )}
      {calls.map((call) => {
        const expanded = open === call.id;
        return (
          <li key={call.id} className={`text-sm ${compact ? 'ml-4' : ''}`}>
            <button
              type="button"
              onClick={() => setOpen(expanded ? null : call.id)}
              aria-expanded={expanded}
              className="flex max-w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-slate-600 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              {STATUS_ICON[call.status]}
              <span className="min-w-0 truncate">{label(call)}</span>
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
