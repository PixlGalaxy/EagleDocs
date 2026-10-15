import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { useI18n } from '../../i18n/I18nContext';
import Modal from './Modal';
import { btn } from './styles';

type Ask = (
  action: () => void,
  /** `tone: 'primary'` for a safe action (the default red button is for deleting). */
  options?: { title?: string; body?: string; confirmLabel?: string; tone?: 'danger' | 'primary' },
) => void;

const ConfirmContext = createContext<Ask>((action) => action());

/** One shared "are you sure?" dialog for destructive actions. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [pending, setPending] = useState<{ action: () => void; title: string; body: string; confirmLabel: string; tone: 'danger' | 'primary' } | null>(null);

  const ask = useCallback<Ask>(
    (action, options) =>
      setPending({
        action,
        title: options?.title ?? t('confirm.title'),
        body: options?.body ?? t('confirm.body'),
        confirmLabel: options?.confirmLabel ?? t('common.delete'),
        tone: options?.tone ?? 'danger',
      }),
    [t],
  );

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      {pending && (
        <Modal title={pending.title} onClose={() => setPending(null)}>
          <p className="text-sm text-slate-600 dark:text-slate-300">{pending.body}</p>
          <div className="mt-6 flex justify-end gap-2">
            <button type="button" onClick={() => setPending(null)} className={btn.secondary}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={() => {
                pending.action();
                setPending(null);
              }}
              className={pending.tone === 'primary' ? btn.primary : btn.danger}
            >
              {pending.confirmLabel}
            </button>
          </div>
        </Modal>
      )}
    </ConfirmContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useConfirm() {
  return useContext(ConfirmContext);
}
