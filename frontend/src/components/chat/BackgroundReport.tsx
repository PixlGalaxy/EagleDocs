import { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Bot, ChevronRight } from 'lucide-react';
import type { Message } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';

/** The reports of helpers that worked in the background, collapsed; the answer after it sums them up. */
const BackgroundReport = ({ message }: { message: Message }) => {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const tasks = message.background?.tasks ?? [];
  const failed = tasks.filter((task) => task.status !== 'done').length;
  // The first paragraph tells the model where the message comes from; the reports follow.
  const body = message.content.replace(/^\[[^\]]*\]\s*/, '');

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 text-sm dark:border-slate-700 dark:bg-slate-800/50">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-slate-700 dark:text-slate-300"
      >
        <Bot size={15} className="shrink-0 text-[var(--accent-600)] dark:text-[var(--accent-300)]" aria-hidden="true" />
        <span className="font-medium">{t('chat.backgroundDone', { count: tasks.length })}</span>
        {failed > 0 && <span className="text-xs text-rose-600 dark:text-rose-400">{t('chat.backgroundFailed', { count: failed })}</span>}
        <ChevronRight size={14} className={`ml-auto shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden="true" />
      </button>
      {open && (
        <div className="prose-chat max-h-96 overflow-auto border-t border-slate-200 px-4 py-3 text-[14px] text-slate-700 dark:border-slate-700 dark:text-slate-300">
          <Markdown remarkPlugins={[remarkGfm]}>{body}</Markdown>
        </div>
      )}
    </div>
  );
};

export default BackgroundReport;
