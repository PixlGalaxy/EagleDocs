import type { ContextUsage } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';

/** 12345 -> "12k", 1_200_000 -> "1.2M". */
function compact(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens >= 10_000_000 ? 0 : 1)}M`;
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}k`;
  return String(tokens);
}

/**
 * How full the model's context window is. Amber from 60%, red from 75%, where
 * the engine starts summarizing older parts of the chat to make room.
 */
const ContextMeter = ({ usage }: { usage: ContextUsage }) => {
  const { t } = useI18n();
  if (!usage.window) return null;
  const ratio = Math.min(1, usage.used / usage.window);
  const tone = ratio > 0.75 ? 'bg-rose-500' : ratio > 0.6 ? 'bg-amber-500' : 'bg-[var(--accent-500)]';
  const used = compact(usage.used);
  const limit = compact(usage.window);

  return (
    <div
      className="flex shrink-0 items-center gap-2 rounded-lg px-2 py-1 text-xs tabular-nums text-slate-500 dark:text-slate-400"
      title={t('chat.contextTitle', { used: usage.used.toLocaleString(), window: usage.window.toLocaleString() })}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={usage.window}
      aria-valuenow={Math.min(usage.used, usage.window)}
      aria-label={t('chat.contextLabel', { used, window: limit })}
    >
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700" aria-hidden="true">
        <span className={`block h-full rounded-full transition-[width] ${tone}`} style={{ width: `${Math.max(2, Math.round(ratio * 100))}%` }} />
      </span>
      <span className="hidden sm:inline" aria-hidden="true">
        {used} / {limit}
      </span>
    </div>
  );
};

export default ContextMeter;
