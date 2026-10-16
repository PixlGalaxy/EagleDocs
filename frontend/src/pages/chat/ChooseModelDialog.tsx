import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import type { ModelOption } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import Modal from '../../components/ui/Modal';
import { Notice } from '../../components/ui/kit';
import { btn } from '../../components/ui/styles';

interface Props {
  options: ModelOption[];
  /** Saves the choice as the default and sends the waiting message with it. */
  onPick: (ref: string) => Promise<void>;
  onClose: () => void;
}

/** A message went out in Auto with no model to answer it: pick a default (used for every new chat) and send. */
const ChooseModelDialog = ({ options, onPick, onClose }: Props) => {
  const { t } = useI18n();
  const choices = options.filter((o) => o.ref !== 'auto');
  const [picked, setPicked] = useState(choices[0]?.ref ?? '');
  const [busy, setBusy] = useState(false);

  // Grouped like the picker: by where each model comes from (StudyHawk, ChatGPT, an API key).
  const groups = choices.reduce<Record<string, ModelOption[]>>((acc, o) => ((acc[o.source_label] ??= []).push(o), acc), {});

  return (
    <Modal title={t('chat.chooseModelTitle')} onClose={onClose}>
      <p className="text-sm text-slate-600 dark:text-slate-300">{t('chat.chooseModelBody')}</p>
      {choices.length === 0 ? (
        <div className="mt-4 space-y-3">
          <Notice tone="warning">{t('chat.chooseModelNone')}</Notice>
          <Link to="/settings?section=models" className={btn.primary} onClick={onClose}>
            {t('chat.chooseModelSettings')}
          </Link>
        </div>
      ) : (
        <form
          className="mt-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!picked || busy) return;
            setBusy(true);
            void onPick(picked).finally(() => setBusy(false));
          }}
        >
          <fieldset className="scroll-thin max-h-72 space-y-4 overflow-y-auto">
            <legend className="sr-only">{t('chat.chooseModelTitle')}</legend>
            {Object.entries(groups).map(([source, models]) => (
              <div key={source}>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{source}</p>
                <div className="space-y-1">
                  {models.map((m) => (
                    <label
                      key={m.ref}
                      className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm transition ${
                        picked === m.ref
                          ? 'border-[var(--accent-500)] bg-[var(--accent-50)] text-slate-900 dark:bg-[var(--accent-900)]/30 dark:text-white'
                          : 'border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
                      }`}
                    >
                      <input type="radio" name="default-model" value={m.ref} checked={picked === m.ref} onChange={() => setPicked(m.ref)} className="accent-[var(--accent-600)]" />
                      <span className="min-w-0 flex-1 truncate">{m.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </fieldset>
          <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">{t('chat.chooseModelTip')}</p>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={onClose} className={btn.secondary}>
              {t('common.cancel')}
            </button>
            <button type="submit" disabled={!picked || busy} className={btn.primary}>
              {busy && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
              {t('chat.chooseModelSend')}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
};

export default ChooseModelDialog;
