import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Pencil } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';
import { useEnterAddsLine } from './touch';

interface Props {
  content: string;
  /** When it was sent: the time shows inside the bubble. */
  sentAt?: string;
  /** Edits the message: the agent answers the new text, the old version stays reachable. */
  onEdit?: (text: string) => void;
  /** An edited message: which version shows, how many there are, and how to show another. */
  version?: {
    current: number;
    total: number;
    onSwitch: (version: number) => void;
  };
}

/** The student's message: editable like in ChatGPT, with < n/m > between its versions. */
const UserBubble = ({ content, sentAt, onEdit, version }: Props) => {
  const { t, language } = useI18n();
  const [editing, setEditing] = useState(false);
  const enterAddsLine = useEnterAddsLine();
  const [draft, setDraft] = useState(content);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) return;
    const el = box.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  }, [editing]);

  const save = () => {
    const text = draft.trim();
    if (!text || text === content.trim()) return setEditing(false);
    setEditing(false);
    onEdit?.(text);
  };

  if (editing) {
    return (
      <div className="w-full max-w-[85%] rounded-2xl border border-[var(--accent-300)] bg-white p-3 dark:border-[var(--accent-500)]/40 dark:bg-slate-900">
        <label htmlFor="edit-message" className="sr-only">
          {t('chat.editMessage')}
        </label>
        <textarea
          id="edit-message"
          ref={box}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            e.target.style.height = 'auto';
            e.target.style.height = `${Math.min(e.target.scrollHeight, 320)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setEditing(false);
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !enterAddsLine) {
              e.preventDefault();
              save();
            }
          }}
          maxLength={20000}
          className="scroll-thin block w-full resize-none bg-transparent text-[15px] leading-relaxed text-slate-900 focus:outline-none dark:text-slate-100"
        />
        <div className="mt-2 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              setDraft(content);
              setEditing(false);
            }}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!draft.trim()}
            className="rounded-lg bg-[var(--accent-600)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--accent-700)] disabled:opacity-50"
          >
            {t('chat.editSend')}
          </button>
        </div>
      </div>
    );
  }

  const time = sentAt
    ? new Date(sentAt).toLocaleTimeString(language, {
        hour: 'numeric',
        minute: '2-digit',
      })
    : '';
  const versions = version && version.total > 1;

  return (
    <div className="group flex max-w-[85%] flex-col items-end gap-0.5">
      <div className="min-w-0 whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-[var(--accent-600)] px-4 py-2 text-[15px] leading-relaxed text-white">
        {content}
        {/* The time sits on the last line when it fits, like WhatsApp; otherwise it drops below. */}
        {time && (
          <time
            dateTime={sentAt}
            title={new Date(sentAt!).toLocaleString(language)}
            className="float-right ml-3 mt-2 select-none text-[11px] leading-none text-white/70"
          >
            {time}
          </time>
        )}
      </div>
      {(onEdit || versions) && (
        <div className="flex items-center gap-0.5 text-xs text-slate-500 dark:text-slate-400">
          {onEdit && (
            <button
              type="button"
              onClick={() => {
                setDraft(content);
                setEditing(true);
              }}
              aria-label={t('chat.editMessage')}
              title={t('chat.editMessage')}
              className="rounded-md p-1.5 text-slate-400 opacity-0 transition hover:bg-slate-100 hover:text-slate-700 group-hover:opacity-100 focus-visible:opacity-100 dark:hover:bg-slate-800 dark:hover:text-slate-200 [@media(hover:none)]:opacity-100"
            >
              <Pencil size={14} />
            </button>
          )}
          {version && versions && (
            <div
              className="flex items-center gap-1"
              aria-label={t('chat.versionOf', {
                n: version.current,
                total: version.total,
              })}
            >
              <button
                type="button"
                onClick={() => version.onSwitch(version.current - 1)}
                disabled={version.current <= 1}
                aria-label={t('chat.versionPrevious')}
                className="rounded-md p-1 hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-slate-800"
              >
                <ChevronLeft size={14} />
              </button>
              <span className="tabular-nums">
                {version.current}/{version.total}
              </span>
              <button
                type="button"
                onClick={() => version.onSwitch(version.current + 1)}
                disabled={version.current >= version.total}
                aria-label={t('chat.versionNext')}
                className="rounded-md p-1 hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-slate-800"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default UserBubble;
