import { useEffect, useState } from 'react';
import { File, FileImage, FileSpreadsheet, FileText, Presentation } from 'lucide-react';
import { filesApi } from '../../api/account';
import type { WorkspaceEntry } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import { FileGlance, FilePreviewPanel } from '../files/FilePreview';
import { hasHoverPreview, previewKindOf } from '../files/preview';
import { formatSize } from './attachments';

/** The icon for a file's kind (slides, picture, sheet, document...). */
const FileIcon = ({ name, size, className }: { name: string; size: number; className: string }) => {
  if (/\.(pptx?|key|odp)$/i.test(name)) return <Presentation size={size} className={className} aria-hidden="true" />;
  switch (previewKindOf(name)) {
    case 'image':
      return <FileImage size={size} className={className} aria-hidden="true" />;
    case 'spreadsheet':
      return <FileSpreadsheet size={size} className={className} aria-hidden="true" />;
    case 'document':
    case 'pdf':
    case 'markdown':
    case 'html':
    case 'text':
      return <FileText size={size} className={className} aria-hidden="true" />;
    default:
      return <File size={size} className={className} aria-hidden="true" />;
  }
};

/** One linked file: a small live glance (PDF, Word, Excel, picture, text...) or its icon; click to open it whole. */
export const FileCard = ({ path }: { path: string }) => {
  const { t } = useI18n();
  const [entry, setEntry] = useState<WorkspaceEntry | null | 'missing'>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    filesApi
      .stat(path)
      .then((e) => !cancelled && setEntry(e.type === 'file' ? e : 'missing'))
      .catch(() => !cancelled && setEntry('missing'));
    return () => {
      cancelled = true;
    };
  }, [path]);

  // A file that is gone (deleted, moved) gets no card; the link in the text stays.
  if (entry === 'missing') return null;
  const name = entry?.name ?? path.split('/').pop() ?? path;
  return (
    <>
      <button
        type="button"
        onClick={() => entry && setOpen(true)}
        disabled={!entry}
        title={t('chat.openFile', { name })}
        className="not-prose flex w-56 shrink-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white text-left transition hover:border-[var(--accent-400)] hover:shadow-md dark:border-slate-700 dark:bg-slate-900"
      >
        <span className="pointer-events-none block h-32 overflow-hidden bg-slate-50 dark:bg-slate-950" aria-hidden="true">
          {entry && hasHoverPreview(entry) ? (
            <FileGlance entry={entry} />
          ) : (
            <span className="flex h-full items-center justify-center">
              <FileIcon name={name} size={34} className="text-slate-300 dark:text-slate-600" />
            </span>
          )}
        </span>
        <span className="flex items-center gap-2 border-t border-slate-200 px-3 py-2 dark:border-slate-700">
          <FileIcon name={name} size={15} className="shrink-0 text-[var(--accent-500)]" />
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-700 dark:text-slate-200">{name}</span>
          {entry && <span className="shrink-0 text-[11px] text-slate-400">{formatSize(entry.size)}</span>}
        </span>
      </button>
      {open && entry && <FilePreviewPanel entry={entry} onClose={() => setOpen(false)} />}
    </>
  );
};

/** The cards for the files one paragraph or list item links to, right under it. */
export const FileCards = ({ paths }: { paths: string[] }) =>
  paths.length ? (
    <div className="not-prose my-2 flex flex-wrap gap-3">
      {paths.map((path) => (
        <FileCard key={path} path={path} />
      ))}
    </div>
  ) : null;
