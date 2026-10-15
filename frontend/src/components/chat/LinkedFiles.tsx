import { useEffect, useState } from 'react';
import { File, FileImage, FileSpreadsheet, FileText, Presentation } from 'lucide-react';
import { filesApi } from '../../api/account';
import type { WorkspaceEntry } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import { FileGlance, FilePreviewPanel } from '../files/FilePreview';
import { hasHoverPreview, previewKindOf } from '../files/preview';
import { fileUrl, formatSize, workspaceLinkPath } from './attachments';

/** Cards after one paragraph or list item, at most this many. */
const MAX_CARDS = 3;
const DOWNLOAD = fileUrl('').split('?')[0]!;

/** The workspace path a rendered link points to (a download link, or a workspace: link as written), or null. */
function filePathOf(href: unknown): string | null {
  if (typeof href !== 'string' || !href) return null;
  if (href.startsWith(`${DOWNLOAD}?`)) return new URLSearchParams(href.slice(DOWNLOAD.length + 1)).get('path');
  return workspaceLinkPath(href);
}

/** The parts of a markdown node these helpers read (hast elements and text). */
interface MdNode {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: MdNode[];
}

/**
 * The workspace files a paragraph or list item links to, in order and once
 * each. Lists inside it are left to their own items; pictures already show inline.
 */
export function linkedFilesIn(node: MdNode | undefined): string[] {
  const out: string[] = [];
  const walk = (n: MdNode) => {
    if (n.type !== 'element') return;
    if (n.tagName === 'ul' || n.tagName === 'ol') return;
    if (n.tagName === 'a') {
      const path = filePathOf(n.properties?.href);
      if (path && !out.includes(path)) out.push(path);
      return;
    }
    n.children?.forEach(walk);
  };
  node?.children?.forEach(walk);
  return out.slice(0, MAX_CARDS);
}

const ICONS = { image: FileImage, spreadsheet: FileSpreadsheet, document: FileText, pdf: FileText, markdown: FileText, html: FileText, text: FileText } as const;
const iconFor = (name: string) => (/\.(pptx?|key|odp)$/i.test(name) ? Presentation : (ICONS[previewKindOf(name) as keyof typeof ICONS] ?? File));

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
  const Icon = iconFor(name);
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
              <Icon size={34} className="text-slate-300 dark:text-slate-600" />
            </span>
          )}
        </span>
        <span className="flex items-center gap-2 border-t border-slate-200 px-3 py-2 dark:border-slate-700">
          <Icon size={15} className="shrink-0 text-[var(--accent-500)]" aria-hidden="true" />
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
