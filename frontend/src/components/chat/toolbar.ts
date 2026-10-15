import type { ReasoningLevel } from '../../api/types';

/** The composer toolbar's quiet buttons: icon (and label from `sm` up) on a transparent pill. */
export const toolbarButton =
  'inline-flex h-9 min-w-9 shrink-0 items-center justify-center rounded-full text-sm text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-500)]/50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent aria-expanded:bg-slate-100 aria-expanded:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white dark:disabled:hover:bg-transparent dark:aria-expanded:bg-slate-800 dark:aria-expanded:text-white';

/** The thinking selector's choices, the model's default first, then lightest to heaviest. */
export const REASONING_LEVELS: readonly ReasoningLevel[] = ['default', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh'];
