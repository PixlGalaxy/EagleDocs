import { useState } from 'react';
import { Check, ChevronDown, Circle, CircleDashed, Loader2 } from 'lucide-react';
import type { PlanStep } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import type { TranslationKey } from '../../i18n/translations';

interface Props {
  title?: string;
  steps: PlanStep[];
  /** Sliding away (the answer ended a while ago). */
  leaving: boolean;
}

const STATUS_LABEL: Record<PlanStep['status'], TranslationKey> = {
  done: 'chat.planDone',
  in_progress: 'chat.planInProgress',
  pending: 'chat.planPending',
  skipped: 'chat.planSkipped',
};

/** One step as a dot: done is filled with the accent, the current one half filled, the rest white. */
const Dot = ({ step, n }: { step: PlanStep; n: number }) => {
  const { t } = useI18n();
  const [hover, setHover] = useState(false);
  const fill =
    step.status === 'done'
      ? 'bg-[var(--accent-500)]'
      : step.status === 'skipped'
        ? 'bg-slate-300 dark:bg-slate-600'
        : step.status === 'in_progress'
          ? 'bg-[linear-gradient(90deg,var(--accent-500)_50%,#fff_50%)]'
          : 'bg-white';
  return (
    <span className="relative flex" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <span
        aria-hidden="true"
        className={`block h-5 w-5 rounded-full border-2 border-slate-800 transition-colors duration-500 dark:border-slate-200 ${fill} ${
          step.status === 'in_progress' ? 'motion-safe:animate-[plan-pulse_1.6s_ease-in-out_infinite]' : ''
        }`}
      />
      {hover && (
        <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 w-max max-w-56 -translate-x-1/2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs leading-snug text-slate-700 shadow-lg dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
          <span className="font-semibold">{n}.</span> {step.title}
          <span className="block text-[11px] text-slate-500 dark:text-slate-400">{t(STATUS_LABEL[step.status])}</span>
        </span>
      )}
    </span>
  );
};

const StepIcon = ({ status }: { status: PlanStep['status'] }) =>
  status === 'done' ? (
    <Check size={14} className="text-[var(--accent-600)] dark:text-[var(--accent-400)]" aria-hidden="true" />
  ) : status === 'in_progress' ? (
    <Loader2 size={14} className="animate-spin text-[var(--accent-600)] motion-reduce:animate-none dark:text-[var(--accent-400)]" aria-hidden="true" />
  ) : status === 'skipped' ? (
    <CircleDashed size={14} className="text-slate-400" aria-hidden="true" />
  ) : (
    <Circle size={14} className="text-slate-400" aria-hidden="true" />
  );

/**
 * The agent's plan above the message box: a dot per step (hover for its name), the
 * current one half filled. Click to see every step. Slides up when the plan starts.
 */
const PlanDock = ({ title, steps, leaving }: Props) => {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const done = steps.filter((s) => s.status === 'done' || s.status === 'skipped').length;

  return (
    <div className={`ml-auto w-fit max-w-full ${leaving ? 'plan-out' : 'plan-in'}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="block w-full min-w-56 rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 text-left shadow-lg backdrop-blur transition hover:border-[var(--accent-300)] dark:border-slate-700 dark:bg-slate-900/95 dark:hover:border-[var(--accent-500)]/50"
      >
        <span className="flex items-center gap-3">
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{title || t('chat.planTitle')}</span>
          <span className="shrink-0 text-xs tabular-nums text-slate-500 dark:text-slate-400">{t('chat.planProgress', { done, total: steps.length })}</span>
          <ChevronDown size={15} className={`shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        </span>
        <span className="mt-2.5 flex flex-wrap items-center gap-2.5" aria-hidden={open}>
          {steps.map((step, i) => (
            <Dot key={i} step={step} n={i + 1} />
          ))}
        </span>
        {/* For screen readers the dots are a list of the steps and where each one is. */}
        {!open && (
          <span className="sr-only">
            {steps.map((s, i) => `${i + 1}. ${s.title}: ${t(STATUS_LABEL[s.status])}`).join('; ')}
          </span>
        )}
        {open && (
          <ol className="mt-3 space-y-1.5 border-t border-slate-100 pt-3 dark:border-slate-800">
            {steps.map((step, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className="mt-0.5 shrink-0">
                  <StepIcon status={step.status} />
                </span>
                <span className={`min-w-0 ${step.status === 'done' || step.status === 'skipped' ? 'text-slate-500 dark:text-slate-400' : 'text-slate-800 dark:text-slate-200'} ${step.status === 'skipped' ? 'line-through' : ''}`}>
                  <span className="tabular-nums text-slate-400">{i + 1}.</span> {step.title}
                  <span className="sr-only"> ({t(STATUS_LABEL[step.status])})</span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </button>
    </div>
  );
};

export default PlanDock;
