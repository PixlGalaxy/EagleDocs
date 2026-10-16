import { useEffect, useState } from 'react';
import { Maximize2, Minimize2, Sparkles } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';

interface Props {
  title: string;
  /** The page's own URL: served with a sandbox CSP (scripts run, but no app access and no network). */
  src: string;
}

/**
 * An interactive page the agent made (show_html), right in the chat. The frame
 * is sandboxed here too: scripts only, an opaque origin, no forms, pop-ups or
 * navigation of this page. "Open" makes the same frame fill the screen: the
 * server only serves it inside a frame, never as a tab of its own, where a
 * script could navigate away carrying what the page shows.
 */
const HtmlDisplay = ({ title, src }: Props) => {
  const { t } = useI18n();
  const [full, setFull] = useState(false);

  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFull(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [full]);

  return (
    <figure
      className={
        full
          ? 'fixed inset-0 z-50 flex flex-col bg-white dark:bg-slate-900'
          : 'overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700'
      }
    >
      <figcaption className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800/60">
        <Sparkles size={14} className="shrink-0 text-[var(--accent-600)]" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate font-medium text-slate-700 dark:text-slate-200">{title}</span>
        <button
          type="button"
          onClick={() => setFull((f) => !f)}
          className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100"
        >
          {full ? <Minimize2 size={13} aria-hidden="true" /> : <Maximize2 size={13} aria-hidden="true" />}
          {full ? t('common.close') : t('chat.htmlOpen')}
        </button>
      </figcaption>
      <iframe
        src={src}
        title={title}
        sandbox="allow-scripts"
        loading="lazy"
        referrerPolicy="no-referrer"
        className={full ? 'block min-h-0 w-full flex-1 border-0 bg-white' : 'block h-[520px] w-full resize-y border-0 bg-white'}
      />
    </figure>
  );
};

export default HtmlDisplay;
