import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronDown, Plus, Wand2 } from 'lucide-react';
import type { ModelOption } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';

interface Props {
  options: ModelOption[];
  value: string;
  onChange: (ref: string) => void;
  disabled?: boolean;
}

/** "Auto" first, then every model grouped by where it comes from (EagleDocs, ChatGPT, API keys). */
const ModelPicker = ({ options, value, onChange, disabled }: Props) => {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const groups = options.reduce<Record<string, ModelOption[]>>((acc, option) => {
    (acc[option.source_label] ??= []).push(option);
    return acc;
  }, {});

  const current = value === 'auto' ? t('models.auto') : (options.find((o) => o.ref === value)?.label ?? t('models.pick'));

  const choose = (next: string) => {
    onChange(next);
    setOpen(false);
  };

  const itemClass = (selected: boolean) =>
    `flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition ${
      selected ? 'bg-[var(--accent-50)] text-[var(--accent-800)] dark:bg-[var(--accent-500)]/15 dark:text-[var(--accent-200)]' : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800'
    }`;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex max-w-[60vw] items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-60 dark:text-slate-200 dark:hover:bg-slate-800 sm:max-w-xs"
      >
        {value === 'auto' && <Wand2 size={15} className="shrink-0 text-[var(--accent-600)] dark:text-[var(--accent-300)]" aria-hidden="true" />}
        <span className="truncate">{current}</span>
        <ChevronDown size={15} className="shrink-0" aria-hidden="true" />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={t('models.pick')}
          className="scroll-thin absolute left-0 z-30 mt-1 max-h-[60vh] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-slate-200 bg-white py-1.5 shadow-lg dark:border-slate-700 dark:bg-slate-900"
        >
          <button type="button" role="option" aria-selected={value === 'auto'} onClick={() => choose('auto')} className={itemClass(value === 'auto')}>
            <Wand2 size={16} className="shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{t('models.auto')}</span>
              <span className="block text-xs text-slate-500 dark:text-slate-400">{t('models.autoHint')}</span>
            </span>
            {value === 'auto' && <Check size={16} aria-hidden="true" />}
          </button>

          {Object.entries(groups).map(([source, items]) => (
            <div key={source} className="mt-1.5 border-t border-slate-100 pt-1.5 dark:border-slate-800">
              <p className="px-3 pb-1 pt-1 text-xs font-medium text-slate-500 dark:text-slate-400">{source}</p>
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
              className="flex items-center gap-3 px-3 py-2 text-sm font-medium text-[var(--accent-700)] hover:bg-slate-100 dark:text-[var(--accent-300)] dark:hover:bg-slate-800"
            >
              <Plus size={16} aria-hidden="true" />
              {t('models.connectMore')}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
};

export default ModelPicker;
