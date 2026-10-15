import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Clock, Download, ExternalLink, File, FileImage, FileText, Folder, FolderOpen, Loader2, Paperclip, RefreshCw, X } from 'lucide-react';
import { filesApi } from '../../api/account';
import type { WorkspaceEntry } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import Modal from '../../components/ui/Modal';
import { MarkdownBody } from '../../components/chat/MessageView';
import { fileUrl, formatSize, isImageName, isMarkdownName, isTextName } from '../../components/chat/attachments';

/** Bigger text files only offer a download: the preview is for a quick look. */
const MAX_PREVIEW_BYTES = 512 * 1024;
const TEMP = 'TEMP';

type FolderState = { entries: WorkspaceEntry[] } | 'error';

/** Folders first, TEMP (wiped after a day) last, then by name. */
function sortEntries(entries: WorkspaceEntry[]): WorkspaceEntry[] {
  return [...entries].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    if (!!a.temp !== !!b.temp) return a.temp ? 1 : -1;
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  });
}

const iconFor = (entry: WorkspaceEntry) => (isImageName(entry.name) ? FileImage : isTextName(entry.name) ? FileText : File);

/** A quick look at a workspace file: photos and text inline, anything else as a download. */
const FilePreview = ({ entry, onClose, onAttach }: { entry: WorkspaceEntry; onClose: () => void; onAttach: () => void }) => {
  const { t } = useI18n();
  const image = isImageName(entry.name);
  const text = !image && isTextName(entry.name) && entry.size <= MAX_PREVIEW_BYTES;
  const [content, setContent] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!text) return;
    let cancelled = false;
    fetch(fileUrl(entry.path), { credentials: 'include' })
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error(res.statusText))))
      .then((body) => !cancelled && setContent(body))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [entry.path, text]);

  return (
    <Modal title={entry.name} onClose={onClose} size="lg">
      <div className="space-y-4">
        {image ? (
          <img src={fileUrl(entry.path, true)} alt={entry.name} className="mx-auto max-h-[65vh] max-w-full rounded-lg object-contain" />
        ) : text ? (
          failed ? (
            <p className="text-sm text-rose-600 dark:text-rose-400">{t('chat.previewError')}</p>
          ) : content === null ? (
            <Loader2 size={20} className="mx-auto animate-spin text-slate-400 motion-reduce:animate-none" aria-hidden="true" />
          ) : isMarkdownName(entry.name) ? (
            <div className="prose-chat scroll-thin max-h-[65vh] overflow-auto text-[15px] text-slate-800 dark:text-slate-200">
              <MarkdownBody text={content} />
            </div>
          ) : (
            <pre className="scroll-thin max-h-[65vh] overflow-auto rounded-lg bg-slate-50 p-4 font-mono text-xs leading-relaxed text-slate-800 dark:bg-slate-950 dark:text-slate-200">{content}</pre>
          )
        ) : (
          <p className="text-sm text-slate-600 dark:text-slate-300">{isTextName(entry.name) ? t('chat.previewTooBig') : t('chat.previewNone')}</p>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="mr-auto text-xs text-slate-500 dark:text-slate-400">{formatSize(entry.size)}</span>
          <a href={fileUrl(entry.path)} download={entry.name} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
            <Download size={15} aria-hidden="true" />
            {t('chat.downloadFile')}
          </a>
          <button
            type="button"
            onClick={() => {
              onAttach();
              onClose();
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-600)] px-3 py-2 text-sm font-medium text-white transition hover:bg-[var(--accent-700)]"
          >
            <Paperclip size={15} aria-hidden="true" />
            {t('chat.attach')}
          </button>
        </div>
      </div>
    </Modal>
  );
};

interface Props {
  /** Adds a workspace file to the message being written (no new upload). */
  onAttach: (entry: WorkspaceEntry) => void;
  onClose: () => void;
  /** Changes when the agent may have written files (a run ended): open folders reload. */
  refreshKey: number;
}

/** The student's workspace as a tree next to the chat: look at files and attach them to a message. */
const WorkspacePanel = ({ onAttach, onClose, refreshKey }: Props) => {
  const { t } = useI18n();
  const [folders, setFolders] = useState<Record<string, FolderState>>({});
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [preview, setPreview] = useState<WorkspaceEntry | null>(null);
  const expandedRef = useRef(expanded);
  useEffect(() => {
    expandedRef.current = expanded;
  }, [expanded]);

  const load = useCallback(
    (path: string) =>
      filesApi
        .list(path)
        .then(({ entries }) => setFolders((prev) => ({ ...prev, [path]: { entries: sortEntries(entries) } })))
        .catch(() => setFolders((prev) => ({ ...prev, [path]: 'error' }))),
    [],
  );

  // The root and every open folder; again whenever a run may have changed files.
  const reloadAll = useCallback(() => Promise.all(['', ...expandedRef.current].map(load)), [load]);
  useEffect(() => {
    void reloadAll();
  }, [reloadAll, refreshKey]);

  const toggle = (path: string) => {
    const next = new Set(expanded);
    if (next.has(path)) next.delete(path);
    else {
      next.add(path);
      if (!folders[path] || folders[path] === 'error') void load(path);
    }
    setExpanded(next);
  };

  const refresh = () => {
    setRefreshing(true);
    void reloadAll().finally(() => setRefreshing(false));
  };

  const rows = (path: string, depth: number): ReactNode => {
    const state = folders[path];
    const pad = { paddingLeft: `${0.5 + depth * 0.875}rem` };
    if (!state)
      return (
        <li style={pad} className="flex items-center gap-2 py-1.5 pr-2 text-xs text-slate-400">
          <Loader2 size={13} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
        </li>
      );
    if (state === 'error')
      return (
        <li style={pad} className="py-1.5 pr-2 text-xs text-rose-600 dark:text-rose-400">
          {t('chat.filesError')}
        </li>
      );
    if (!state.entries.length)
      return (
        <li style={pad} className="py-1.5 pr-2 text-xs text-slate-400 dark:text-slate-500">
          {path ? t('chat.filesEmpty') : t('chat.filesRootEmpty')}
        </li>
      );
    return state.entries.map((entry) => {
      const temp = entry.temp || entry.path === TEMP || entry.path.startsWith(`${TEMP}/`);
      if (entry.type === 'dir') {
        const open = expanded.has(entry.path);
        const FolderIcon = entry.temp ? Clock : open ? FolderOpen : Folder;
        return (
          <li key={entry.path}>
            <button
              type="button"
              onClick={() => toggle(entry.path)}
              aria-expanded={open}
              style={pad}
              title={entry.temp ? t('files.tempBadge', { hours: 24 }) : entry.name}
              className="flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <ChevronRight size={13} className={`shrink-0 text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden="true" />
              <FolderIcon size={15} className={`shrink-0 ${temp ? 'text-amber-500' : 'text-[var(--accent-500)]'}`} aria-hidden="true" />
              <span className="min-w-0 truncate">{entry.name}</span>
              {entry.temp && (
                <span className="ml-auto shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">24 h</span>
              )}
            </button>
            {open && <ul>{rows(entry.path, depth + 1)}</ul>}
          </li>
        );
      }
      const Icon = iconFor(entry);
      return (
        <li key={entry.path} className="group flex items-center rounded-md hover:bg-slate-100 dark:hover:bg-slate-800">
          <button
            type="button"
            onClick={() => setPreview(entry)}
            style={{ paddingLeft: `${1.3 + depth * 0.875}rem` }}
            title={`${entry.name} · ${formatSize(entry.size)}`}
            className={`flex min-w-0 flex-1 items-center gap-1.5 py-1.5 pr-1 text-left text-sm ${temp ? 'text-amber-800 dark:text-amber-200/90' : 'text-slate-600 dark:text-slate-400'}`}
          >
            <Icon size={15} className="shrink-0 text-slate-400" aria-hidden="true" />
            <span className="min-w-0 truncate">{entry.name}</span>
          </button>
          <span className="flex shrink-0 items-center pr-1 opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
            <button
              type="button"
              onClick={() => onAttach(entry)}
              aria-label={t('chat.attachFile', { name: entry.name })}
              title={t('chat.attachFile', { name: entry.name })}
              className="rounded-md p-1 text-slate-400 hover:bg-white hover:text-[var(--accent-600)] dark:hover:bg-slate-700 dark:hover:text-[var(--accent-300)]"
            >
              <Paperclip size={13} />
            </button>
            <a
              href={fileUrl(entry.path)}
              download={entry.name}
              aria-label={t('files.download', { name: entry.name })}
              title={t('chat.downloadFile')}
              className="rounded-md p-1 text-slate-400 hover:bg-white hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200"
            >
              <Download size={13} />
            </a>
          </span>
        </li>
      );
    });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-1 border-b border-slate-200 px-3 dark:border-slate-800">
        <h2 className="mr-auto text-sm font-semibold text-slate-900 dark:text-slate-100">{t('chat.filesTitle')}</h2>
        <button
          type="button"
          onClick={refresh}
          disabled={refreshing}
          aria-label={t('chat.filesRefresh')}
          title={t('chat.filesRefresh')}
          className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-60 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          <RefreshCw size={15} className={refreshing ? 'animate-spin motion-reduce:animate-none' : ''} />
        </button>
        <Link to="/files" aria-label={t('nav.files')} title={t('nav.files')} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800">
          <ExternalLink size={15} />
        </Link>
        <button type="button" onClick={onClose} aria-label={t('chat.hideFiles')} title={t('chat.hideFiles')} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800">
          <X size={16} />
        </button>
      </div>
      <ul className="scroll-thin min-h-0 flex-1 overflow-y-auto p-2">{rows('', 0)}</ul>
      {preview && <FilePreview entry={preview} onClose={() => setPreview(null)} onAttach={() => onAttach(preview)} />}
    </div>
  );
};

export default WorkspacePanel;
