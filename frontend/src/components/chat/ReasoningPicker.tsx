import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Lightbulb } from 'lucide-react';
import type { ReasoningLevel } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import type { TranslationKey } from '../../i18n/translations';
import Popover from './Popover';
import { menuKeys } from './menuKeys';
import { REASONING_LEVELS, toolbarButton } from './toolbar';

const LABELS: Record<ReasoningLevel, TranslationKey> = {
  default: 'chat.reasoningDefault',
  none: 'chat.reasoningNone',
  minimal: 'chat.reasoningMinimal',
  low: 'chat.reasoningLow',
  medium: 'chat.reasoningMedium',
  high: 'chat.reasoningHigh',
  xhigh: 'chat.reasoningXhigh',
};

interface Props {
  value: ReasoningLevel;
  onChange: (level: ReasoningLevel) => void;
  disabled?: boolean;
}

/** How hard the model thinks before answering: Default, None, Minimal ... Extra High. */
const ReasoningPicker = ({ value, onChange, disabled }: Props) => {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const shown = open && !disabled;

  useEffect(() => {
    if (!shown) return;
    const frame = requestAnimationFrame(() => list.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus());
    return () => cancelAnimationFrame(frame);
  }, [shown]);

  const choose = (level: ReasoningLevel) => {
    onChange(level);
    setOpen(false);
    trigger.current?.focus();
  };

  const label = t(LABELS[value]);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={shown}
        aria-label={`${t('chat.reasoning')}: ${label}`}
        title={`${t('chat.reasoning')}: ${label}`}
        className={`${toolbarButton} gap-1.5 px-2`}
      >
        <Lightbulb size={16} className={`shrink-0 ${value !== 'default' && value !== 'none' ? 'text-[var(--accent-600)] dark:text-[var(--accent-300)]' : ''}`} aria-hidden="true" />
        <span className="hidden whitespace-nowrap sm:inline">{label}</span>
        <ChevronDown size={14} className="shrink-0 opacity-70" aria-hidden="true" />
      </button>

      <Popover
        anchor={trigger}
        open={shown}
        onClose={() => setOpen(false)}
        role="menu"
        aria-label={t('chat.reasoning')}
        className="w-52 rounded-xl border border-slate-200 bg-white py-1.5 shadow-lg dark:border-slate-700 dark:bg-slate-900"
      >
        <div ref={list} onKeyDown={menuKeys}>
          <p className="px-3 pb-1 pt-1 text-xs font-medium text-slate-500 dark:text-slate-400" aria-hidden="true">
            {t('chat.reasoning')}
          </p>
          {REASONING_LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              role="menuitemradio"
              aria-checked={value === level}
              onClick={() => choose(level)}
              className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition focus:outline-none focus-visible:bg-slate-100 dark:focus-visible:bg-slate-800 ${
                value === level
                  ? 'bg-[var(--accent-50)] text-[var(--accent-800)] dark:bg-[var(--accent-500)]/15 dark:text-[var(--accent-200)]'
                  : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800'
              }`}
            >
              <span className="flex-1">{t(LABELS[level])}</span>
              {value === level && <Check size={16} aria-hidden="true" />}
            </button>
          ))}
        </div>
      </Popover>
    </>
  );
};

export default ReasoningPicker;
