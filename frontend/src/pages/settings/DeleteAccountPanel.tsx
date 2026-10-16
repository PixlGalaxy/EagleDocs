import { useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { CircleAlert, Loader2, Trash2 } from 'lucide-react';
import { authApi } from '../../api/auth';
import { ApiError } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useI18n } from '../../i18n/I18nContext';
import Modal from '../../components/ui/Modal';
import { Field, Notice, Panel } from '../../components/ui/kit';
import { btn, input } from '../../components/ui/styles';
import { PasswordInput } from '../auth/AuthShell';

/**
 * Settings → Account: deleting one's own account. The account is switched off
 * at once and erased after 30 days, unless its owner signs in again before.
 * `exportSlot`: the "download my data" control, shown again inside the dialog.
 */
const DeleteAccountPanel = ({ exportSlot }: { exportSlot?: ReactNode }) => {
  const { t, language } = useI18n();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ username: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deleteAfter, setDeleteAfter] = useState<string | null>(null);

  if (!user) return null;

  const close = () => {
    if (deleteAfter) {
      // Its sessions are gone (logout tolerates that): leave the app.
      void logout().finally(() => navigate('/', { replace: true }));
      return;
    }
    setOpen(false);
    setForm({ username: '', password: '' });
    setError('');
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await authApi.deleteAccount(form.password, form.username);
      setDeleteAfter(new Intl.DateTimeFormat(language, { dateStyle: 'long' }).format(new Date(result.delete_after)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.networkError'));
    } finally {
      setBusy(false);
    }
  };

  const confirmed = form.username.trim().toLowerCase() === user.username.toLowerCase() && form.password.length > 0;

  return (
    <>
      <Panel title={t('account.deleteTitle')} description={t('account.deleteBody')}>
        <button type="button" onClick={() => setOpen(true)} className={btn.danger}>
          <Trash2 size={16} aria-hidden="true" />
          {t('account.deleteButton')}
        </button>
      </Panel>

      {open && (
        <Modal title={t('account.deleteTitle')} onClose={close} dismissible={!busy}>
          {deleteAfter ? (
            <div className="space-y-4">
              <Notice tone="success">{t('account.deleteScheduled', { date: deleteAfter })}</Notice>
              <button type="button" onClick={close} className={btn.primary}>
                {t('common.close')}
              </button>
            </div>
          ) : (
            <form onSubmit={(e) => void submit(e)} className="space-y-4">
              <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-700 dark:text-slate-300">
                <li>{t('account.deleteWhat')}</li>
                <li>{t('account.deleteGrace')}</li>
                <li>{t('account.deletePlan')}</li>
              </ul>
              {exportSlot && <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">{exportSlot}</div>}
              <Field label={t('account.deleteTypeUsername', { username: user.username })}>
                {(id) => (
                  <input id={id} autoComplete="off" spellCheck={false} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} className={input} required />
                )}
              </Field>
              <Field label={t('account.currentPassword')}>
                {(id) => <PasswordInput id={id} autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />}
              </Field>
              {error && (
                <Notice tone="danger" icon={CircleAlert}>
                  {error}
                </Notice>
              )}
              <div className="flex flex-wrap justify-end gap-2">
                <button type="button" onClick={close} disabled={busy} className={btn.secondary}>
                  {t('common.cancel')}
                </button>
                <button type="submit" disabled={busy || !confirmed} className={`${btn.danger} disabled:bg-slate-300 dark:disabled:bg-slate-700`}>
                  {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Trash2 size={16} aria-hidden="true" />}
                  {t('account.deleteConfirm')}
                </button>
              </div>
            </form>
          )}
        </Modal>
      )}
    </>
  );
};

export default DeleteAccountPanel;
