import { useEffect, useRef, type FormEvent, type KeyboardEvent } from 'react';
import { ArrowUp, CornerDownRight, Square } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop?: () => void;
  /** While busy: sends the text as a correction instead of a new message. */
  onSteer?: () => void;
  busy: boolean;
  disabled?: boolean;
}

const MAX_HEIGHT = 220;

/**
 * Auto-growing textarea. Enter sends, Shift+Enter adds a line. While the agent
 * works it stays active: Enter sends a correction (steer) and Stop sits next to it.
 */
const Composer = ({ value, onChange, onSubmit, onStop, onSteer, busy, disabled }: Props) => {
  const { t } = useI18n();
  const ref = useRef<HTMLTextAreaElement>(null);
  const steering = busy && !!onSteer;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [value]);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!value.trim() || disabled) return;
    if (steering) onSteer!();
    else if (!busy) onSubmit();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const iconButton =
    'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition active:scale-[0.96] disabled:bg-slate-200 disabled:text-slate-400 dark:disabled:bg-slate-800 dark:disabled:text-slate-500';

  return (
    <form onSubmit={submit} className="mx-auto w-full max-w-3xl">
      <div className="flex items-end gap-2 rounded-2xl border border-slate-300 bg-white p-2 shadow-sm focus-within:border-[var(--accent-400)] focus-within:ring-2 focus-within:ring-[var(--accent-500)]/30 dark:border-slate-700 dark:bg-slate-900">
        <label htmlFor="composer" className="sr-only">
          {t(steering ? 'chat.steerLabel' : 'chat.composerLabel')}
        </label>
        <textarea
          id="composer"
          ref={ref}
          rows={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={disabled}
          maxLength={steering ? 2000 : 20000}
          placeholder={t(steering ? 'chat.steerPlaceholder' : 'chat.composerPlaceholder')}
          className="max-h-[220px] min-h-[40px] flex-1 resize-none bg-transparent px-2 py-2 text-[15px] text-slate-900 placeholder-slate-500 focus:outline-none disabled:cursor-not-allowed dark:text-slate-100 dark:placeholder-slate-400"
        />
        {steering && (
          <button
            type="submit"
            disabled={!value.trim() || disabled}
            aria-label={t('chat.steer')}
            title={t('chat.steer')}
            className={`${iconButton} bg-amber-400 text-amber-950 hover:bg-amber-500`}
          >
            <CornerDownRight size={18} aria-hidden="true" />
          </button>
        )}
        {busy && onStop ? (
          <button
            type="button"
            onClick={onStop}
            aria-label={t('chat.stop')}
            title={t('chat.stop')}
            className={`${iconButton} bg-slate-900 text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white`}
          >
            <Square size={14} fill="currentColor" aria-hidden="true" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!value.trim() || disabled || busy}
            aria-label={t('chat.send')}
            title={t('chat.send')}
            className={`${iconButton} bg-[var(--accent-600)] text-white hover:bg-[var(--accent-700)]`}
          >
            <ArrowUp size={18} aria-hidden="true" />
          </button>
        )}
      </div>
      <p className="mt-2 text-center text-xs text-slate-500 dark:text-slate-400">{t(steering ? 'chat.steerHint' : 'chat.disclaimer')}</p>
    </form>
  );
};

export default Composer;
