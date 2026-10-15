import { useEffect, useState } from 'react';
import { CHAT_COLUMN } from './layout';
import { Loader2, Square } from 'lucide-react';
import { chatApi } from '../../api/chat';
import type { BackgroundJob, SubagentProgress } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import { SubagentList } from './ToolCallList';
import { applySubagentEvent } from './subagents';

/** One background job: follows its stream until the helpers finish. */
const BackgroundJobCard = ({ chatId, job, onFinished }: { chatId: string; job: BackgroundJob; onFinished: () => void }) => {
  const { t } = useI18n();
  const [progress, setProgress] = useState<SubagentProgress[]>([]);
  const [stopping, setStopping] = useState(false);

  useEffect(
    () =>
      chatApi.stream(chatId, job.id, (event) => {
        if (event.type === 'subagent') setProgress((prev) => applySubagentEvent(prev, event));
        else if (event.type === 'done' || event.type === 'error') onFinished();
      }),
    [chatId, job.id, onFinished],
  );

  // Before the first event, show the tasks as they were handed out.
  const shown: SubagentProgress[] = job.tasks.map(
    (task, index) => progress.find((p) => p.index === index) ?? { index, task: task.goal.slice(0, 200), status: 'running', steps: [] },
  );

  return (
    <div className="rounded-xl border border-slate-200 bg-white/80 px-3 py-2.5 dark:border-slate-700 dark:bg-slate-900/80">
      <div className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
        <Loader2 size={14} className="shrink-0 animate-spin text-[var(--accent-500)] motion-reduce:animate-none" aria-hidden="true" />
        <span className="min-w-0 font-medium">{t('chat.backgroundTitle', { count: job.tasks.length })}</span>
        <button
          type="button"
          disabled={stopping}
          onClick={() => {
            setStopping(true);
            void chatApi.cancel(job.id).catch(() => setStopping(false));
          }}
          className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        >
          <Square size={11} aria-hidden="true" />
          {stopping ? t('chat.backgroundStopping') : t('chat.backgroundStop')}
        </button>
      </div>
      <SubagentList subagents={shown} />
    </div>
  );
};

/** Helper agents working in the background for this chat; the chat stays free meanwhile. */
const BackgroundTasks = ({ chatId, jobs, onFinished }: { chatId: string; jobs: BackgroundJob[]; onFinished: () => void }) => {
  if (jobs.length === 0) return null;
  return (
    // Capped so many helpers never squeeze the conversation on a phone.
    <div className={`scroll-thin mx-auto mb-2 max-h-[40vh] w-full ${CHAT_COLUMN} space-y-2 overflow-y-auto`} aria-live="polite">
      {jobs.map((job) => (
        <BackgroundJobCard key={job.id} chatId={chatId} job={job} onFinished={onFinished} />
      ))}
    </div>
  );
};

export default BackgroundTasks;
