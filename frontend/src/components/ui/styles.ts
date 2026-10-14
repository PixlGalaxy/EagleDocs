export const btn = {
  primary:
    'inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--accent-600)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--accent-700)] disabled:bg-slate-300 dark:disabled:bg-slate-700 dark:disabled:text-slate-500',
  secondary:
    'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700',
  danger:
    'inline-flex items-center justify-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-700',
  success:
    'inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 dark:disabled:text-slate-500',
  warning:
    'inline-flex items-center justify-center gap-2 rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-amber-950 transition hover:bg-amber-500 disabled:bg-slate-300 dark:disabled:bg-slate-700 dark:disabled:text-slate-500',
  accent:
    'inline-flex items-center justify-center gap-2 rounded-lg bg-fuchsia-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-fuchsia-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 dark:disabled:text-slate-500',
  info: 'inline-flex items-center justify-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 dark:disabled:text-slate-500',
  // inline-flex so <a> and <button> render an identical box: a bare <a> is
  // inline and would sit differently from a button with the same padding.
  iconGhost:
    'inline-flex items-center justify-center rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-white',
  iconDanger:
    'inline-flex items-center justify-center rounded-lg p-2 text-slate-500 transition hover:bg-rose-50 hover:text-rose-600 dark:text-slate-400 dark:hover:bg-rose-500/15 dark:hover:text-rose-400',
};

export const input =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[var(--accent-500)] focus:border-transparent dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';

export const label = 'block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5';

export const card =
  'rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900';

export const errorBox =
  'rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300';
