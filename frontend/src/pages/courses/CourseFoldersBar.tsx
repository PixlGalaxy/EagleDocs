import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FolderOpen, Loader2, RefreshCw } from 'lucide-react';
import { canvasApi } from '../../api/account';
import { ApiError } from '../../api/client';
import type { CourseFoldersStatus } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import { btn } from '../../components/ui/styles';

/** "<Term>/<Course>/" folders kept from Canvas in the student's files: when they last synced, sync now, open them. */
const CourseFoldersBar = () => {
  const { t, language } = useI18n();
  const [status, setStatus] = useState<CourseFoldersStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    canvasApi
      .folders()
      .then(setStatus)
      .catch(() => undefined);
  }, []);

  const sync = async () => {
    setBusy(true);
    setError('');
    try {
      await canvasApi.syncFolders();
      setStatus(await canvasApi.folders());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.networkError'));
    } finally {
      setBusy(false);
    }
  };

  const when = status?.synced_at ? new Date(status.synced_at).toLocaleString(language, { dateStyle: 'medium', timeStyle: 'short' }) : null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm dark:border-slate-800 dark:bg-slate-900">
      <FolderOpen size={18} className="shrink-0 text-[var(--accent-600)] dark:text-[var(--accent-300)]" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-slate-900 dark:text-slate-100">{status?.term ? t('folders.title', { term: status.term }) : t('folders.titleNone')}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {error || status?.error
            ? <span className="text-rose-600 dark:text-rose-400">{error || status?.error}</span>
            : when
              ? t('folders.synced', { count: status?.courses ?? 0, when })
              : t('folders.notYet')}
        </p>
      </div>
      {status?.term && (
        <Link to={`/files?path=${encodeURIComponent(status.term)}`} className={btn.secondary}>
          {t('folders.open')}
        </Link>
      )}
      <button type="button" onClick={() => void sync()} disabled={busy} className={btn.secondary}>
        {busy ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} aria-hidden="true" />}
        {busy ? t('folders.syncing') : t('folders.sync')}
      </button>
    </div>
  );
};

export default CourseFoldersBar;
