import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronRight, CircleAlert, Clock, Download, File, FileText, Folder, FolderClock, FolderPlus, HardDrive, Home, Loader2, Trash2, Upload, type LucideIcon } from 'lucide-react';
import { filesApi } from '../../api/account';
import { ApiError } from '../../api/client';
import type { TempUsage, WorkspaceEntry, WorkspaceUsage } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import { Page } from '../../components/layout/routes';
import { Badge, EmptyState, Notice, Skeleton } from '../../components/ui/kit';
import Modal from '../../components/ui/Modal';
import { btn, card, input } from '../../components/ui/styles';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

const TEXT_EXT = /\.(md|txt|csv|json|py|js|ts|docx?|pptx|pdf)$/i;
const TEMP = 'TEMP';

function UsageMeter({ icon: Icon, label, value, usage }: { icon: LucideIcon; label: string; value: string; usage: WorkspaceUsage }) {
  const percent = Math.min(100, (usage.used_mb / Math.max(1, usage.limit_mb)) * 100);
  return (
    <div className="flex items-center gap-3 text-sm text-slate-600 dark:text-slate-400">
      <Icon size={16} aria-hidden="true" />
      <span className="w-24 shrink-0 truncate">{label}</span>
      <div
        className="h-1.5 w-40 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={usage.limit_mb}
        aria-valuenow={usage.used_mb}
        aria-label={label}
      >
        <div className={`h-full rounded-full ${percent > 90 ? 'bg-rose-500' : 'bg-[var(--accent-500)]'}`} style={{ width: `${percent}%` }} />
      </div>
      <span className="font-mono text-xs">{value}</span>
    </div>
  );
}

/** The user's sandbox workspace, read straight from shared storage (works while the sandbox is off). */
const FilesPage = () => {
  const { t, language } = useI18n();
  const [params, setParams] = useSearchParams();
  const path = params.get('path') ?? '';
  const [entries, setEntries] = useState<WorkspaceEntry[] | null>(null);
  const [usage, setUsage] = useState<WorkspaceUsage | null>(null);
  const [temp, setTemp] = useState<TempUsage | null>(null);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<WorkspaceEntry | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    filesApi
      .list(path)
      .then(({ entries, usage, temp }) => {
        setError('');
        setEntries(entries);
        setUsage(usage);
        setTemp(temp);
      })
      .catch((err) => {
        setEntries([]);
        setError(err instanceof ApiError ? err.message : t('common.networkError'));
      });
  }, [path, t]);

  const [shownPath, setShownPath] = useState(path);
  if (shownPath !== path) {
    setShownPath(path);
    setEntries(null);
  }

  useEffect(load, [load]);

  const open = (next: string) => setParams(next ? { path: next } : {});
  const crumbs = path.split('/').filter(Boolean);
  const inTemp = crumbs[0] === TEMP;
  const ttl = temp?.ttl_hours ?? 24;

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    setError('');
    try {
      for (const file of Array.from(files)) await filesApi.upload(path, file);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.networkError'));
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const createFolder = async (e: FormEvent) => {
    e.preventDefault();
    if (!newFolder?.trim()) return;
    try {
      await filesApi.mkdir([path, newFolder.trim()].filter(Boolean).join('/'));
      setNewFolder(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.networkError'));
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await filesApi.remove(deleting.path);
      setDeleting(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.networkError'));
    }
  };

  return (
    <Page title={t('nav.files')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{t('nav.files')}</h1>
        <div className="flex gap-2">
          <button type="button" onClick={() => setNewFolder('')} className={btn.secondary}>
            <FolderPlus size={16} aria-hidden="true" />
            {t('files.newFolder')}
          </button>
          <button type="button" onClick={() => fileInput.current?.click()} disabled={uploading} className={btn.primary}>
            {uploading ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Upload size={16} aria-hidden="true" />}
            {t('files.upload')}
          </button>
          <input ref={fileInput} type="file" multiple hidden onChange={(e) => void upload(e.target.files)} />
        </div>
      </div>

      <p className="mt-1 max-w-[65ch] text-sm text-slate-500 dark:text-slate-400">{t('files.intro')}</p>

      {usage && (
        <div className="mt-5 space-y-1.5">
          <UsageMeter icon={HardDrive} label={t('files.workspace')} usage={usage} value={t('files.usageValue', { used: usage.used_mb.toFixed(0), limit: usage.limit_mb })} />
          {temp && <UsageMeter icon={Clock} label={TEMP} usage={temp} value={t('files.usageValue', { used: temp.used_mb.toFixed(0), limit: temp.limit_mb })} />}
        </div>
      )}

      <nav className="mt-5 flex flex-wrap items-center gap-1 text-sm" aria-label={t('files.breadcrumbs')}>
        <button type="button" onClick={() => open('')} className="flex items-center gap-1.5 rounded-md px-2 py-1 font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
          <Home size={15} aria-hidden="true" />
          {t('files.workspace')}
        </button>
        {crumbs.map((crumb, i) => (
          <span key={i} className="flex items-center gap-1">
            <ChevronRight size={14} className="text-slate-400" aria-hidden="true" />
            <button type="button" onClick={() => open(crumbs.slice(0, i + 1).join('/'))} className="rounded-md px-2 py-1 text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
              {crumb}
            </button>
          </span>
        ))}
      </nav>

      {inTemp && (
        <div className="mt-4">
          <Notice tone="warning" icon={Clock}>
            {t('files.tempNotice', { hours: ttl })}
          </Notice>
        </div>
      )}

      {error && (
        <div className="mt-4">
          <Notice tone="danger" icon={CircleAlert}>
            {error}
          </Notice>
        </div>
      )}

      <div className="mt-4">
        {entries === null ? (
          <div className="space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <EmptyState icon={Folder} title={t('files.emptyTitle')} description={t('files.emptyBody')} />
        ) : (
          <div className={`${card} overflow-hidden`}>
            <table className="w-full table-fixed text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-2.5">{t('files.name')}</th>
                  <th className="hidden w-52 px-4 py-2.5 sm:table-cell">{t('files.modified')}</th>
                  <th className="hidden w-28 px-4 py-2.5 text-right sm:table-cell">{t('files.size')}</th>
                  <th className="w-24 px-4 py-2.5">
                    <span className="sr-only">{t('files.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {entries.map((entry) => (
                  <tr key={entry.path} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-2.5">
                      {entry.type === 'dir' ? (
                        <button type="button" onClick={() => open(entry.path)} className="flex max-w-full items-center gap-2.5 font-medium text-slate-900 hover:text-[var(--accent-700)] dark:text-slate-100 dark:hover:text-[var(--accent-300)]">
                          {entry.temp ? <FolderClock size={18} className="shrink-0 text-amber-500" aria-hidden="true" /> : <Folder size={18} className="shrink-0 text-[var(--accent-500)]" aria-hidden="true" />}
                          <span className="truncate">{entry.label ?? entry.name}</span>
                          {entry.temp && <Badge tone="warning">{t('files.tempBadge', { hours: ttl })}</Badge>}
                        </button>
                      ) : (
                        <span className="flex items-center gap-2.5 text-slate-800 dark:text-slate-200">
                          {TEXT_EXT.test(entry.name) ? <FileText size={18} className="shrink-0 text-slate-400" aria-hidden="true" /> : <File size={18} className="shrink-0 text-slate-400" aria-hidden="true" />}
                          <span className="truncate">{entry.name}</span>
                        </span>
                      )}
                    </td>
                    <td className="hidden whitespace-nowrap px-4 py-2.5 text-slate-500 dark:text-slate-400 sm:table-cell">
                      {new Date(entry.modified_at).toLocaleString(language, { dateStyle: 'medium', timeStyle: 'short' })}
                    </td>
                    <td className="hidden whitespace-nowrap px-4 py-2.5 text-right font-mono text-xs text-slate-500 dark:text-slate-400 sm:table-cell">
                      {entry.type === 'file' ? formatSize(entry.size) : ''}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end gap-1">
                        {entry.type === 'file' && (
                          <a href={filesApi.downloadUrl(entry.path)} className={btn.iconGhost} aria-label={t('files.download', { name: entry.name })}>
                            <Download size={16} />
                          </a>
                        )}
                        {!entry.temp && (
                          <button type="button" onClick={() => setDeleting(entry)} className={btn.iconDanger} aria-label={t('files.delete', { name: entry.name })}>
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {newFolder !== null && (
        <Modal title={t('files.newFolder')} onClose={() => setNewFolder(null)}>
          <form onSubmit={(e) => void createFolder(e)} className="space-y-5">
            <label htmlFor="folder-name" className="sr-only">
              {t('files.name')}
            </label>
            <input id="folder-name" autoFocus value={newFolder} onChange={(e) => setNewFolder(e.target.value)} className={input} maxLength={120} />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setNewFolder(null)} className={btn.secondary}>
                {t('common.cancel')}
              </button>
              <button type="submit" className={btn.primary}>
                {t('common.create')}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {deleting && (
        <Modal title={t('files.deleteTitle')} onClose={() => setDeleting(null)}>
          <p className="text-sm text-slate-600 dark:text-slate-300">{t('files.deleteBody', { name: deleting.name })}</p>
          <div className="mt-6 flex justify-end gap-2">
            <button type="button" onClick={() => setDeleting(null)} className={btn.secondary}>
              {t('common.cancel')}
            </button>
            <button type="button" onClick={() => void confirmDelete()} className={btn.danger}>
              {t('common.delete')}
            </button>
          </div>
        </Modal>
      )}
    </Page>
  );
};

export default FilesPage;
