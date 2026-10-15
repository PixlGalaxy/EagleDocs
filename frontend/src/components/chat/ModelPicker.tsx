import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Box, Check, ChevronDown, Plus, Wand2, type LucideIcon } from 'lucide-react';
import type { ModelOption } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import Popover from './Popover';
import { menuKeys } from './menuKeys';
import { toolbarButton } from './toolbar';

interface Props {
  options: ModelOption[];
  value: string;
  onChange: (ref: string) => void;
  disabled?: boolean;
  /** Opens from this button instead of the current model's (e.g. "Try again with..."). */
  trigger?: { label: string; icon: LucideIcon };
}

/** "Auto" first, then every model grouped by where it comes from (EagleDocs, ChatGPT, API keys). */
const ModelPicker = ({ options, value, onChange, disabled, trigger: custom }: Props) => {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const shown = open && !disabled;

  // The menu opens on the current choice, ready for the arrow keys.
  useEffect(() => {
    if (!shown) return;
    const frame = requestAnimationFrame(() => {
      const items = list.current?.querySelectorAll<HTMLElement>('[role="option"]');
      const selected = list.current?.querySelector<HTMLElement>('[aria-selected="true"]');
      (selected ?? items?.[0])?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [shown]);

  const groups = options.reduce<Record<string, ModelOption[]>>((acc, option) => {
    (acc[option.source_label] ??= []).push(option);
    return acc;
  }, {});

  const current = value === 'auto' ? t('models.auto') : (options.find((o) => o.ref === value)?.label ?? t('models.pick'));

  const choose = (next: string) => {
    onChange(next);
    setOpen(false);
    trigger.current?.focus();
  };

  const itemClass = (selected: boolean) =>
    `flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition focus:outline-none focus-visible:bg-slate-100 dark:focus-visible:bg-slate-800 ${
      selected ? 'bg-[var(--accent-50)] text-[var(--accent-800)] dark:bg-[var(--accent-500)]/15 dark:text-[var(--accent-200)]' : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800'
    }`;

  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={shown}
        aria-label={custom ? custom.label : `${t('models.pick')}: ${current}`}
        title={custom ? custom.label : disabled ? t('chat.modelLocked') : current}
        className={`${toolbarButton} max-w-[14rem] gap-1.5 px-2 font-medium`}
      >
        {custom ? (
          <>
            <custom.icon size={15} className="shrink-0" aria-hidden="true" />
            <span className="truncate">{custom.label}</span>
          </>
        ) : value === 'auto' ? (
          <Wand2 size={16} className="shrink-0 text-[var(--accent-600)] dark:text-[var(--accent-300)]" aria-hidden="true" />
        ) : (
          <Box size={16} className="shrink-0" aria-hidden="true" />
        )}
        {!custom && <span className="hidden truncate sm:inline">{current}</span>}
        <ChevronDown size={14} className="shrink-0 opacity-70" aria-hidden="true" />
      </button>

      <Popover
        anchor={trigger}
        open={shown}
        onClose={() => setOpen(false)}
        role="listbox"
        aria-label={t('models.pick')}
        className="w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white py-1.5 shadow-lg dark:border-slate-700 dark:bg-slate-900"
      >
        <div ref={list} onKeyDown={menuKeys}>
          <button type="button" role="option" aria-selected={value === 'auto'} onClick={() => choose('auto')} className={itemClass(value === 'auto')}>
            <Wand2 size={16} className="shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{t('models.auto')}</span>
              <span className="block text-xs text-slate-500 dark:text-slate-400">{t('models.autoHint')}</span>
            </span>
            {value === 'auto' && <Check size={16} aria-hidden="true" />}
          </button>

          {Object.entries(groups).map(([source, items]) => (
            <div key={source} role="group" aria-label={source} className="mt-1.5 border-t border-slate-100 pt-1.5 dark:border-slate-800">
              <p className="px-3 pb-1 pt-1 text-xs font-medium text-slate-500 dark:text-slate-400" aria-hidden="true">
                {source}
              </p>
              {items.map((option) => (
                <button
                  key={option.ref}
                  type="button"
                  role="option"
                  aria-selected={value === option.ref}
                  onClick={() => choose(option.ref)}
                  className={itemClass(value === option.ref)}
                >
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  {!option.supports_tools && <span className="shrink-0 text-xs text-slate-400">{t('models.noTools')}</span>}
                  {value === option.ref && <Check size={16} aria-hidden="true" />}
                </button>
              ))}
            </div>
          ))}

          <div className="mt-1.5 border-t border-slate-100 pt-1.5 dark:border-slate-800">
            <Link
              to="/settings?section=models"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 px-3 py-2 text-sm font-medium text-[var(--accent-700)] hover:bg-slate-100 focus:outline-none focus-visible:bg-slate-100 dark:text-[var(--accent-300)] dark:hover:bg-slate-800 dark:focus-visible:bg-slate-800"
            >
              <Plus size={16} aria-hidden="true" />
              {t('models.connectMore')}
            </Link>
          </div>
        </div>
      </Popover>
    </>
  );
};

export default ModelPicker;
