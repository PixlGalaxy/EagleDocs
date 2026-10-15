import { useEffect, useState } from 'react';
import { CircleAlert, FileText, Loader2, X } from 'lucide-react';
import type { MessageAttachment } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import { fileUrl, formatSize, type DraftAttachment } from './attachments';

/** Full-size view of an image; Escape or a click anywhere closes it. */
export const ImageLightbox = ({ src, name, onClose }: { src: string; name: string; onClose: () => void }) => {
  const { t } = useI18n();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div role="dialog" aria-modal="true" aria-label={name} className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4" onClick={onClose}>
      <button type="button" onClick={onClose} aria-label={t('chat.closeImage')} className="absolute right-3 top-3 rounded-full bg-white/10 p-2 text-white hover:bg-white/20">
        <X size={20} />
      </button>
      <img src={src} alt={name} className="max-h-full max-w-full rounded-lg object-contain shadow-2xl" />
    </div>
  );
};

/** The files waiting in the composer: thumbnails for photos, chips for the rest, each with its upload state. */
export const AttachmentTray = ({ items, onRemove }: { items: DraftAttachment[]; onRemove: (id: string) => void }) => {
  const { t } = useI18n();
  if (!items.length) return null;
  return (
    <ul className="flex flex-wrap gap-2 px-1 pb-2">
      {items.map((a) => {
        const uploading = !a.path && !a.error;
        const src = a.preview ?? (a.kind === 'image' && a.path ? fileUrl(a.path, true) : null);
        return (
          <li
            key={a.id}
            title={a.error ? `${t('chat.uploadFailed')}: ${a.error}` : a.name}
            className={`group relative flex h-14 max-w-[14rem] items-center overflow-hidden rounded-xl border bg-slate-50 dark:bg-slate-800 ${
              a.error ? 'border-rose-300 dark:border-rose-500/50' : 'border-slate-200 dark:border-slate-700'
            }`}
          >
            {src ? (
              <img src={src} alt="" className="h-14 w-14 shrink-0 object-cover" />
            ) : (
              <span className="flex h-14 w-10 shrink-0 items-center justify-center text-slate-400">
                <FileText size={18} aria-hidden="true" />
              </span>
            )}
            {!src || a.kind !== 'image' ? (
              <span className="min-w-0 pr-7 text-xs">
                <span className="block truncate font-medium text-slate-700 dark:text-slate-200">{a.name}</span>
                <span className={`block truncate ${a.error ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500 dark:text-slate-400'}`}>
                  {a.error ? t('chat.uploadFailed') : uploading ? t('chat.uploading') : formatSize(a.size)}
                </span>
              </span>
            ) : (
              <span className="sr-only">{a.name}</span>
            )}
            {/* Upload state over a photo: a spinner, or a warning when it failed. */}
            {a.kind === 'image' && src && (uploading || a.error) && (
              <span className="absolute inset-y-0 left-0 flex w-14 items-center justify-center bg-slate-900/40 text-white">
                {a.error ? <CircleAlert size={18} aria-label={t('chat.uploadFailed')} /> : <Loader2 size={18} className="animate-spin motion-reduce:animate-none" aria-label={t('chat.uploading')} />}
              </span>
            )}
            {uploading && (
              <span className="absolute inset-x-0 bottom-0 h-0.5 bg-slate-200 dark:bg-slate-700" aria-hidden="true">
                <span className="block h-full bg-[var(--accent-500)] transition-[width]" style={{ width: `${Math.round(a.progress * 100)}%` }} />
              </span>
            )}
            <button
              type="button"
              onClick={() => onRemove(a.id)}
              aria-label={t('chat.removeAttachment', { name: a.name })}
              className="absolute right-1 top-1 rounded-full bg-slate-900/60 p-0.5 text-white opacity-90 transition hover:bg-slate-900/80 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100 [@media(hover:none)]:opacity-90"
            >
              <X size={12} />
            </button>
          </li>
        );
      })}
    </ul>
  );
};

/** Files sent with a user message: photo thumbnails (click for full size) and file chips (click to download). */
export const MessageAttachments = ({ items }: { items: MessageAttachment[] }) => {
  const { t } = useI18n();
  const [open, setOpen] = useState<MessageAttachment | null>(null);
  const images = items.filter((a) => a.kind === 'image');
  const files = items.filter((a) => a.kind !== 'image');

  return (
    <div className="flex max-w-[85%] flex-col items-end gap-1.5">
      {images.length > 0 && (
        <div className="flex flex-wrap justify-end gap-1.5">
          {images.map((a) => (
            <button
              key={a.path}
              type="button"
              onClick={() => setOpen(a)}
              aria-label={t('chat.openImage', { name: a.name })}
              className="overflow-hidden rounded-xl border border-slate-200 bg-slate-100 transition hover:opacity-90 dark:border-slate-700 dark:bg-slate-800"
            >
              <img src={fileUrl(a.path, true)} alt={a.name} loading="lazy" className={`${images.length === 1 ? 'max-h-60 max-w-full' : 'h-28 w-28'} object-cover`} />
            </button>
          ))}
        </div>
      )}
      {files.map((a) => (
        <a
          key={a.path}
          href={fileUrl(a.path)}
          download={a.name}
          className="flex max-w-full items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm transition hover:border-[var(--accent-300)] dark:border-slate-700 dark:bg-slate-900 dark:hover:border-[var(--accent-500)]/50"
        >
          <FileText size={18} className="shrink-0 text-[var(--accent-600)] dark:text-[var(--accent-300)]" aria-hidden="true" />
          <span className="min-w-0">
            <span className="block truncate font-medium text-slate-800 dark:text-slate-200">{a.name}</span>
            <span className="block text-xs text-slate-500 dark:text-slate-400">{formatSize(a.size)}</span>
          </span>
        </a>
      ))}
      {open && <ImageLightbox src={fileUrl(open.path, true)} name={open.name} onClose={() => setOpen(null)} />}
    </div>
  );
};
