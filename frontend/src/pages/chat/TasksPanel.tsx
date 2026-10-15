import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Ban, Bot, CalendarClock, Check, ChevronRight, CircleAlert, Hourglass, ListChecks, Loader2, RotateCcw, Smartphone, Square } from 'lucide-react';
import { chatApi } from '../../api/chat';
import type { Job } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import type { TranslationKey } from '../../i18n/translations';

const ACTIVE: Job['status'][] = ['queued', 'running', 'waiting_approval', 'waiting_mfa'];
/** Recent finished tasks worth showing: the last day. */
const RECENT_MS = 24 * 3600 * 1000;

const ICON: Record<Job['status'], React.ReactNode> = {
  queued: <Hourglass size={13} className="text-slate-400" />,
  running: <Loader2 size={13} className="animate-spin text-[var(--accent-500)] motion-reduce:animate-none" />,
  waiting_approval: <Hourglass size={13} className="text-amber-500" />,
  waiting_mfa: <Smartphone size={13} className="text-amber-500" />,
  done: <Check size={13} className="text-emerald-500" />,
  failed: <CircleAlert size={13} className="text-rose-500" />,
  interrupted: <CircleAlert size={13} className="text-amber-500" />,
  cancelled: <Ban size={13} className="text-slate-400" />,
};

const STATUS_LABEL: Record<Job['status'], TranslationKey> = {
  queued: 'tasks.queued',
  running: 'tasks.running',
  waiting_approval: 'tasks.waitingApproval',
  waiting_mfa: 'tasks.waitingMfa',
  done: 'tasks.done',
  failed: 'tasks.failed',
  interrupted: 'tasks.interrupted',
  cancelled: 'tasks.cancelled',
};

/** What runs (or just ran) for the student across chats: open the chat, stop it, or run a stopped one again. */
const TasksPanel = ({ onNavigate }: { onNavigate?: () => void }) => {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(() => {
    chatApi
      .jobs()
      .then((list) =>
        setJobs(list.filter((job) => job.kind !== 'sync' && (ACTIVE.includes(job.status) || Date.now() - Date.parse(job.finished_at ?? job.queued_at ?? '') < RECENT_MS))),
      )
      .catch(() => undefined);
  }, []);

  const activeCount = jobs.filter((job) => ACTIVE.includes(job.status)).length;
  // Often while something runs, rarely otherwise.
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, activeCount > 0 || open ? 4000 : 30_000);
    return () => clearInterval(timer);
  }, [refresh, activeCount, open]);

  if (jobs.length === 0) return null;

  const go = (job: Job) => {
    if (!job.chat_id) return;
    navigate(`/chat/${job.chat_id}`);
    onNavigate?.();
  };
  const act = async (job: Job, action: 'cancel' | 'retry') => {
    setBusy(job.id);
    try {
      if (action === 'cancel') await chatApi.cancel(job.id);
      else {
        const { chat_id } = await chatApi.retry(job.id);
        navigate(`/chat/${chat_id}`);
        onNavigate?.();
      }
    } catch {
      // The list shows the real state on the next refresh.
    } finally {
      setBusy(null);
      refresh();
    }
  };

  return (
    <div className="border-t border-slate-200 px-2 py-2 dark:border-slate-800">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
      >
        <ListChecks size={15} aria-hidden="true" />
        <span className="font-medium">{t('tasks.title')}</span>
        {activeCount > 0 && <span className="rounded-full bg-[var(--accent-600)] px-1.5 text-[11px] font-semibold text-white">{activeCount}</span>}
        <ChevronRight size={14} className={`ml-auto transition-transform ${open ? '-rotate-90' : ''}`} aria-hidden="true" />
      </button>
      {open && (
        <ul className="scroll-thin max-h-64 space-y-0.5 overflow-y-auto pt-1">
          {jobs.map((job) => {
            const active = ACTIVE.includes(job.status);
            const retryable = (job.status === 'interrupted' || job.status === 'failed') && job.kind !== 'delegate';
            const KindIcon = job.kind === 'delegate' ? Bot : job.kind === 'scheduled' ? CalendarClock : null;
            return (
              <li key={job.id} className="group flex items-center gap-1 rounded-lg pr-1 hover:bg-slate-100 dark:hover:bg-slate-800">
                <button type="button" onClick={() => go(job)} className="flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-left text-xs" title={t(STATUS_LABEL[job.status])}>
                  <span className="shrink-0" aria-label={t(STATUS_LABEL[job.status])}>
                    {ICON[job.status]}
                  </span>
                  {KindIcon && <KindIcon size={12} className="shrink-0 text-slate-400" aria-hidden="true" />}
                  <span className="truncate text-slate-700 dark:text-slate-300">
                    {job.kind === 'delegate' ? t('tasks.helpers', { chat: job.chat_title ?? '' }) : job.chat_title || t('chat.untitled')}
                  </span>
                </button>
                {active && (
                  <button
                    type="button"
                    disabled={busy === job.id}
                    onClick={() => void act(job, 'cancel')}
                    aria-label={t('tasks.stop')}
                    title={t('tasks.stop')}
                    className="rounded-md p-1 text-slate-400 hover:bg-white hover:text-rose-600 disabled:opacity-50 dark:hover:bg-slate-700"
                  >
                    <Square size={12} />
                  </button>
                )}
                {retryable && (
                  <button
                    type="button"
                    disabled={busy === job.id}
                    onClick={() => void act(job, 'retry')}
                    aria-label={t('tasks.retry')}
                    title={t('tasks.retry')}
                    className="rounded-md p-1 text-slate-400 hover:bg-white hover:text-[var(--accent-600)] disabled:opacity-50 dark:hover:bg-slate-700"
                  >
                    <RotateCcw size={12} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default TasksPanel;
