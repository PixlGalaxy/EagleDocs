import { useId, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { card } from './styles';

/** Label above, hint and error below: the one form-field layout used everywhere. */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: (id: string, describedBy: string | undefined) => ReactNode;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-slate-700 dark:text-slate-300">
        {label}
      </label>
      {children(id, describedBy)}
      {hint && (
        <p id={hintId} className="text-xs text-slate-500 dark:text-slate-400">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs font-medium text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}
    </div>
  );
}

/** Accessible on/off switch. */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-500)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:focus-visible:ring-offset-slate-900 ${
        checked ? 'bg-[var(--accent-600)]' : 'bg-slate-300 dark:bg-slate-600'
      }`}
    >
      <span
        className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`}
      />
    </button>
  );
}

/** A titled card that groups one settings topic. */
export function Panel({
  title,
  description,
  actions,
  children,
  className = '',
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`${card} p-5 sm:p-6 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
          {description && <p className="mt-1 max-w-[65ch] text-sm text-slate-500 dark:text-slate-400">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
      </div>
      {children && <div className="mt-5">{children}</div>}
    </section>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 px-6 py-12 text-center dark:border-slate-700">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--accent-50)] text-[var(--accent-600)] dark:bg-[var(--accent-500)]/15 dark:text-[var(--accent-300)]">
        <Icon size={22} aria-hidden="true" />
      </div>
      <h3 className="font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-sm text-slate-500 dark:text-slate-400">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Shape-matched loading placeholder. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-lg bg-slate-200/80 motion-reduce:animate-none dark:bg-slate-800 ${className}`} />;
}

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

const BADGE: Record<BadgeTone, string> = {
  neutral: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  accent: 'bg-[var(--accent-50)] text-[var(--accent-700)] dark:bg-[var(--accent-500)]/15 dark:text-[var(--accent-200)]',
  success: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  warning: 'bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200',
  danger: 'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
};

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${BADGE[tone]}`}>{children}</span>;
}

/** Inline banner for notices that belong to the page (not transient). */
export function Notice({
  tone = 'neutral',
  icon: Icon,
  children,
}: {
  tone?: 'neutral' | 'warning' | 'danger' | 'success' | 'accent';
  icon?: LucideIcon;
  children: ReactNode;
}) {
  const tones = {
    neutral: 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300',
    accent: 'border-[var(--accent-200)] bg-[var(--accent-50)] text-[var(--accent-800)] dark:border-[var(--accent-500)]/30 dark:bg-[var(--accent-500)]/10 dark:text-[var(--accent-200)]',
    warning: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200',
    danger: 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200',
  };
  return (
    <div className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${tones[tone]}`}>
      {Icon && <Icon size={18} className="mt-0.5 shrink-0" aria-hidden="true" />}
      <div className="min-w-0">{children}</div>
    </div>
  );
}
