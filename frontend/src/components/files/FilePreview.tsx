import { Suspense, lazy, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Code2, Download, Eye, FileQuestion, Loader2, Paperclip, Save, X } from 'lucide-react';
import { filesApi } from '../../api/account';
import { ApiError } from '../../api/client';
import type { WorkspaceEntry } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import { useTheme } from '../../context/ThemeContext';
import { MarkdownBody } from '../chat/MessageView';
import { fileUrl, formatSize } from '../chat/attachments';
import { MEDIA_TYPES, canPreview, extOf, previewKindOf, useBlobSrc, useFileBlob, type PreviewKind } from './preview';
import { BrandLoaderBlock } from '../ui/BrandLoader';

const CodeEditor = lazy(() => import('./CodeEditor'));
const DocumentViewer = lazy(() => import('./DocumentViewer'));
const SpreadsheetViewer = lazy(() => import('./SpreadsheetViewer'));

const isTextKind = (kind: PreviewKind) => kind === 'markdown' || kind === 'html' || kind === 'text';
/** Notebooks are JSON the agent manages; everything else shown as text can be edited and saved. */
const isEditable = (entry: WorkspaceEntry) => isTextKind(previewKindOf(entry.name)) && !/\.ipynb$/i.test(entry.name);

const Spinner = () => <BrandLoaderBlock size={44} />;

const Notice = ({ children }: { children: ReactNode }) => (
  <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-slate-500 dark:text-slate-400">
    <FileQuestion size={40} className="text-slate-300 dark:text-slate-600" aria-hidden="true" />
    {children}
  </div>
);

/** A page's markup, drawn with no scripts and no origin: it can show, never run. */
const HtmlFrame = ({ html, title }: { html: string; title: string }) => (
  <iframe srcDoc={html} title={title} sandbox="" className="h-full w-full border-0 bg-white" />
);

const PdfFrame = ({ blob, title, compact }: { blob: Blob; title: string; compact: boolean }) => {
  const ref = useBlobSrc<HTMLIFrameElement>(blob, MEDIA_TYPES.pdf, compact ? '#toolbar=0&navpanes=0&view=FitH' : '');
  return <iframe ref={ref} title={title} className="h-full w-full border-0 bg-white" />;
};

const Media = ({ blob, name }: { blob: Blob; name: string }) => {
  const type = MEDIA_TYPES[extOf(name)] ?? 'application/octet-stream';
  const video = useBlobSrc<HTMLVideoElement>(blob, type);
  const audio = useBlobSrc<HTMLAudioElement>(blob, type);
  return (
    <div className="flex h-full items-center justify-center p-6">
      {type.startsWith('video/') ? <video ref={video} controls className="max-h-full max-w-full" /> : <audio ref={audio} controls className="w-full max-w-lg" />}
    </div>
  );
};

/** What a file shows when it is not text: shared by the full view and the hover card. */
const BinaryBody = ({ entry, kind, blob, compact }: { entry: WorkspaceEntry; kind: PreviewKind; blob: Blob; compact: boolean }) => {
  if (kind === 'pdf') return <PdfFrame blob={blob} title={entry.name} compact={compact} />;
  if (kind === 'video' || kind === 'audio') return <Media blob={blob} name={entry.name} />;
  return (
    <Suspense fallback={<Spinner />}>
      {kind === 'document' ? <DocumentViewer blob={blob} compact={compact} /> : <SpreadsheetViewer blob={blob} compact={compact} />}
    </Suspense>
  );
};

/** The file's text, read once from its bytes; null while loading. */
function useBlobText(blob: Blob | undefined): string | null {
  const [state, setState] = useState<{ blob: Blob; text: string } | null>(null);
  useEffect(() => {
    if (!blob) return;
    let cancelled = false;
    void blob.text().then((text) => !cancelled && setState({ blob, text }));
    return () => {
      cancelled = true;
    };
  }, [blob]);
  return state && state.blob === blob ? state.text : null;
}

// ------------------------------------------------------------------ full view

interface PanelProps {
  entry: WorkspaceEntry;
  onClose: () => void;
  /** Adds the file to the message being written; without it the panel has no Attach button. */
  onAttach?: () => void;
  /** After a save, so the file list picks up the new size and date. */
  onSaved?: () => void;
}

/**
 * A workspace file opened from the chat: Word and Excel files rendered in the
 * browser, PDFs and media in the browser's own players, and text in an editor
 * that saves back to the workspace (Markdown and HTML also have a rendered view).
 */
export const FilePreviewPanel = ({ entry, onClose, onAttach, onSaved }: PanelProps) => {
  const { t } = useI18n();
  const { mode } = useTheme();
  const kind = previewKindOf(entry.name);
  const textKind = isTextKind(kind);
  const editable = isEditable(entry);
  const empty = entry.size === 0 && (kind === 'document' || kind === 'spreadsheet' || kind === 'pdf');
  const previewable = canPreview(kind, entry.size, 'full') && !empty;
  const file = useFileBlob(entry.path, entry.modified_at, previewable && kind !== 'image');
  const loadedText = useBlobText(textKind ? file?.blob : undefined);

  // The editor's text; `saved` is what is on disk, so the two differing means unsaved changes.
  const [draft, setDraft] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const text = draft ?? loadedText;
  const original = saved ?? loadedText;
  const dirty = text !== null && original !== null && text !== original;
  // Markdown and HTML open as they look; plain text opens straight in the editor.
  const [view, setView] = useState<'rendered' | 'source'>(kind === 'text' ? 'source' : 'rendered');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  const save = async () => {
    if (text === null || !editable || saving) return;
    setSaving(true);
    setStatus(null);
    try {
      await filesApi.saveText(entry.path, text);
      setSaved(text);
      setConfirmClose(false);
      setStatus({ ok: true, message: t('chat.previewSaved') });
      onSaved?.();
    } catch (err) {
      setStatus({ ok: false, message: err instanceof ApiError ? err.message : t('chat.previewSaveFailed') });
    } finally {
      setSaving(false);
    }
  };

  const requestClose = () => (dirty ? setConfirmClose(true) : onClose());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && editable) {
        e.preventDefault();
        if (dirty) void save();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const toggle = (value: 'rendered' | 'source', Icon: typeof Eye, label: string) => (
    <button
      type="button"
      onClick={() => setView(value)}
      aria-pressed={view === value}
      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-medium transition ${
        view === value ? 'bg-[var(--accent-600)] text-white' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
      }`}
    >
      <Icon size={14} aria-hidden="true" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );

  let body: ReactNode;
  if (empty) body = <Notice>{t('chat.previewEmpty')}</Notice>;
  else if (kind === 'image') body = <img src={fileUrl(entry.path, true)} alt={entry.name} className="m-auto block max-h-full max-w-full object-contain p-4" />;
  else if (!previewable)
    body = (
      <Notice>
        <p>{kind === 'none' ? t('chat.previewNone') : t('chat.previewTooBig')}</p>
      </Notice>
    );
  else if (!file) body = <Spinner />;
  else if (!file.blob) body = <Notice>{t('chat.previewError')}</Notice>;
  else if (!textKind) body = <BinaryBody entry={entry} kind={kind} blob={file.blob} compact={false} />;
  else if (text === null) body = <Spinner />;
  else if (view === 'rendered' && kind === 'markdown')
    body = (
      <div className="prose-chat scroll-thin h-full overflow-auto bg-white px-6 py-5 text-[15px] text-slate-800 dark:bg-slate-900 dark:text-slate-200">
        <MarkdownBody text={text} />
      </div>
    );
  else if (view === 'rendered' && kind === 'html') body = <HtmlFrame html={text} title={entry.name} />;
  else
    body = (
      <Suspense fallback={<Spinner />}>
        <CodeEditor name={entry.name} value={text} readOnly={!editable} isDark={mode === 'dark'} onChange={(value) => {
            setDraft(value);
            setStatus(null);
          }} />
      </Suspense>
    );

  const button = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:opacity-50';
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-900/60 p-2 sm:p-8" onClick={requestClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={entry.name}
        className="mx-auto flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-2 border-b border-slate-200 px-3 py-2.5 sm:px-5 dark:border-slate-700">
          <h2 className="min-w-0 flex-1 truncate font-medium text-slate-900 dark:text-slate-100" title={entry.name}>
            {entry.name}
            <span className="ml-2 text-xs font-normal text-slate-500 dark:text-slate-400">{formatSize(entry.size)}</span>
          </h2>
          {status && <span className={`hidden text-xs sm:inline ${status.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{status.message}</span>}
          {(kind === 'markdown' || kind === 'html') && previewable && (
            <div className="flex items-center rounded-lg border border-slate-300 p-0.5 dark:border-slate-600">
              {toggle('rendered', Eye, t('chat.previewRendered'))}
              {toggle('source', Code2, t('chat.previewSource'))}
            </div>
          )}
          {editable && previewable && (
            <button type="button" onClick={() => void save()} disabled={!dirty || saving} title={`${t('chat.previewSave')} (Ctrl+S)`} className={`${button} bg-[var(--accent-600)] text-white hover:bg-[var(--accent-700)]`}>
              {saving ? <Loader2 size={15} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Save size={15} aria-hidden="true" />}
              <span className="hidden sm:inline">{t('chat.previewSave')}</span>
            </button>
          )}
          {onAttach && (
            <button
              type="button"
              onClick={() => {
                onAttach();
                onClose();
              }}
              title={t('chat.attach')}
              className={`${button} border border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800`}
            >
              <Paperclip size={15} aria-hidden="true" />
              <span className="hidden sm:inline">{t('chat.attach')}</span>
            </button>
          )}
          <a href={fileUrl(entry.path)} download={entry.name} title={t('chat.downloadFile')} className={`${button} border border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800`}>
            <Download size={15} aria-hidden="true" />
            <span className="hidden sm:inline">{t('chat.downloadFile')}</span>
          </a>
          <button type="button" onClick={requestClose} aria-label={t('common.close')} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800">
            <X size={18} />
          </button>
        </header>

        {confirmClose && (
          <div className="flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-5 py-2.5 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            <span className="flex-1">{t('chat.previewUnsaved')}</span>
            <button type="button" onClick={onClose} className={`${button} border border-amber-300 hover:bg-amber-100 dark:border-amber-500/40 dark:hover:bg-amber-500/10`}>
              {t('chat.previewDiscard')}
            </button>
            <button type="button" onClick={() => void save()} className={`${button} bg-[var(--accent-600)] text-white hover:bg-[var(--accent-700)]`}>
              {t('chat.previewSave')}
            </button>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-hidden bg-slate-50 dark:bg-slate-950">{body}</div>
      </div>
    </div>
  );
};

// ------------------------------------------------------------------ hover card

const CARD_W = 360;
const CARD_H = 440;
const GAP = 12;
/** A glance needs only the start of a long text. */
const SNIPPET_CHARS = 4000;

/** A glance at a file: the start of a text, the first page of a document, a picture. Also the chat's file cards. */
export const FileGlance = ({ entry }: { entry: WorkspaceEntry }) => {
  const { t } = useI18n();
  const kind = previewKindOf(entry.name);
  const file = useFileBlob(entry.path, entry.modified_at, kind !== 'image');
  const text = useBlobText(isTextKind(kind) ? file?.blob : undefined);

  if (kind === 'image') return <img src={fileUrl(entry.path, true)} alt="" className="m-auto block max-h-full max-w-full rounded-lg object-contain" />;
  if (!file) return <Spinner />;
  if (!file.blob) return <p className="p-4 text-sm text-rose-600 dark:text-rose-400">{t('chat.previewError')}</p>;
  if (!isTextKind(kind)) return <BinaryBody entry={entry} kind={kind} blob={file.blob} compact />;
  if (text === null) return <Spinner />;
  const snippet = text.slice(0, SNIPPET_CHARS);
  if (kind === 'markdown')
    return (
      <div className="prose-chat h-full overflow-hidden px-4 py-3 text-xs text-slate-800 dark:text-slate-200">
        <MarkdownBody text={snippet} />
      </div>
    );
  if (kind === 'html') return <HtmlFrame html={snippet} title={entry.name} />;
  return <pre className="h-full overflow-hidden whitespace-pre-wrap break-words p-3 font-mono text-[11px] leading-relaxed text-slate-700 dark:text-slate-300">{snippet}</pre>;
};

/** A floating glance at a file next to its row: beside it when there is room, never off the screen. */
export const FileHoverCard = ({ entry, anchor }: { entry: WorkspaceEntry; anchor: DOMRect }) => {
  const room = window.innerWidth - anchor.right - GAP;
  const left = room >= CARD_W ? anchor.right + GAP : Math.max(8, anchor.left - GAP - CARD_W);
  const top = Math.min(Math.max(8, anchor.top + anchor.height / 2 - CARD_H / 2), window.innerHeight - CARD_H - 8);

  return createPortal(
    <div
      aria-hidden="true"
      className="pointer-events-none fixed z-50 flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-600 dark:bg-slate-900"
      style={{ left, top, width: CARD_W, height: CARD_H }}
    >
      <div className="truncate border-b border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 dark:border-slate-700 dark:text-slate-300">{entry.name}</div>
      <div className="min-h-0 flex-1 bg-slate-50 dark:bg-slate-950">
        <FileGlance entry={entry} />
      </div>
    </div>,
    document.body,
  );
};
