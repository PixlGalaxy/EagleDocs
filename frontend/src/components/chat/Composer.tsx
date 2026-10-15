import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type FormEvent, type KeyboardEvent } from 'react';
import { ArrowUp, CornerDownRight, Paperclip, Square } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';
import { AttachmentTray } from './AttachmentViews';
import { MAX_ATTACHMENTS, type DraftAttachment } from './attachments';

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop?: () => void;
  /** While busy: sends the text as a correction instead of a new message. */
  onSteer?: () => void;
  busy: boolean;
  disabled?: boolean;
  /** Files waiting to go with the next message; omit to hide the paperclip. */
  attachments?: DraftAttachment[];
  /** Returns how many files did not fit (over the limit). */
  onAttach?: (files: File[]) => number;
  onRemoveAttachment?: (id: string) => void;
}

const MAX_HEIGHT = 220;

/**
 * Auto-growing textarea. Enter sends, Shift+Enter adds a line. While the agent
 * works it stays active: Enter sends a correction (steer) and Stop sits next to it.
 * Photos and files come in through the paperclip, a drop or a paste.
 */
const Composer = ({ value, onChange, onSubmit, onStop, onSteer, busy, disabled, attachments = [], onAttach, onRemoveAttachment }: Props) => {
  const { t } = useI18n();
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [overLimit, setOverLimit] = useState(false);
  const steering = busy && !!onSteer;
  const uploading = attachments.some((a) => !a.path && !a.error);
  const hasFiles = attachments.some((a) => a.path);
  // A message can be only files, but not while one is still uploading.
  const canSend = (!!value.trim() || hasFiles) && !uploading && !disabled;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [value]);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (steering) {
      if (value.trim() && !disabled) onSteer!();
    } else if (!busy && canSend) onSubmit();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const attach = (files: File[]) => {
    if (!onAttach || !files.length) return;
    setOverLimit(onAttach(files) > 0);
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files);
    // Only take over the paste when it carries files (a screenshot); text pastes as usual.
    if (!onAttach || !files.length) return;
    e.preventDefault();
    attach(files);
  };

  const dragHandlers = onAttach
    ? {
        onDragEnter: (e: DragEvent) => {
          if (e.dataTransfer.types.includes('Files')) setDragging(true);
        },
        onDragOver: (e: DragEvent) => {
          if (!e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        },
        onDragLeave: (e: DragEvent) => {
          // Leaving for a child element is not leaving the composer.
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        },
        onDrop: (e: DragEvent) => {
          if (!e.dataTransfer.files.length) return;
          e.preventDefault();
          setDragging(false);
          attach(Array.from(e.dataTransfer.files));
        },
      }
    : {};

  const iconButton =
    'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition active:scale-[0.96] disabled:bg-slate-200 disabled:text-slate-400 dark:disabled:bg-slate-800 dark:disabled:text-slate-500';

  return (
    <form onSubmit={submit} className="mx-auto w-full max-w-3xl" {...dragHandlers}>
      <div
        className={`relative rounded-2xl border bg-white p-2 shadow-sm focus-within:border-[var(--accent-400)] focus-within:ring-2 focus-within:ring-[var(--accent-500)]/30 dark:bg-slate-900 ${
          dragging ? 'border-[var(--accent-500)] ring-2 ring-[var(--accent-500)]/30' : 'border-slate-300 dark:border-slate-700'
        }`}
      >
        {dragging && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-[var(--accent-50)]/90 text-sm font-medium text-[var(--accent-800)] dark:bg-slate-900/90 dark:text-[var(--accent-200)]">
            {t('chat.dropFiles')}
          </div>
        )}
        {onRemoveAttachment && <AttachmentTray items={attachments} onRemove={onRemoveAttachment} />}
        <div className="flex items-end gap-2">
          {onAttach && (
            <>
              <input
                ref={fileInput}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  attach(Array.from(e.target.files ?? []));
                  // The same file can be picked again after removing it.
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                disabled={disabled || attachments.length >= MAX_ATTACHMENTS}
                aria-label={t('chat.attach')}
                title={t('chat.attach')}
                className="flex h-10 w-9 shrink-0 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 disabled:opacity-40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
              >
                <Paperclip size={18} aria-hidden="true" />
              </button>
            </>
          )}
          <label htmlFor="composer" className="sr-only">
            {t(steering ? 'chat.steerLabel' : 'chat.composerLabel')}
          </label>
          <textarea
            id="composer"
            ref={ref}
            rows={1}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            disabled={disabled}
            maxLength={steering ? 2000 : 20000}
            placeholder={t(steering ? 'chat.steerPlaceholder' : 'chat.composerPlaceholder')}
            className="scroll-thin max-h-[220px] min-h-[40px] min-w-0 flex-1 resize-none bg-transparent px-2 py-2 text-[15px] text-slate-900 placeholder-slate-500 focus:outline-none disabled:cursor-not-allowed dark:text-slate-100 dark:placeholder-slate-400"
          />
          {steering && (
            <button
              type="submit"
              disabled={!value.trim() || disabled}
              aria-label={t('chat.steer')}
              title={t('chat.steer')}
              className={`${iconButton} bg-amber-400 text-amber-950 hover:bg-amber-500`}
            >
              <CornerDownRight size={18} aria-hidden="true" />
            </button>
          )}
          {busy && onStop ? (
            <button
              type="button"
              onClick={onStop}
              aria-label={t('chat.stop')}
              title={t('chat.stop')}
              className={`${iconButton} bg-slate-900 text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white`}
            >
              <Square size={14} fill="currentColor" aria-hidden="true" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!canSend || busy}
              aria-label={t('chat.send')}
              title={t('chat.send')}
              className={`${iconButton} bg-[var(--accent-600)] text-white hover:bg-[var(--accent-700)]`}
            >
              <ArrowUp size={18} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      <p className="mt-2 text-center text-xs text-slate-500 dark:text-slate-400">
        {overLimit && attachments.length >= MAX_ATTACHMENTS ? t('chat.attachLimit', { count: MAX_ATTACHMENTS }) : t(steering ? 'chat.steerHint' : 'chat.disclaimer')}
      </p>
    </form>
  );
};

export default Composer;
