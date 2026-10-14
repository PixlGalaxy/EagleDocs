import { memo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CornerDownRight, Sparkles } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';
import type { ToolCall } from '../../api/types';
import ToolCallList from './ToolCallList';
import { LOGO_SRC } from '../brand';

interface Props {
  role: 'user' | 'assistant';
  content: string;
  modelLabel?: string | null;
  toolCalls?: ToolCall[];
  streaming?: boolean;
  /** A correction sent while the agent worked; `pending` until it was applied. */
  steer?: 'pending' | 'applied';
}

const MarkdownBody = memo(({ text }: { text: string }) => (
  <Markdown
    remarkPlugins={[remarkGfm]}
    components={{
      a: ({ href, children }) => (
        <a href={href} target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      ),
    }}
  >
    {text}
  </Markdown>
));

/** One chat turn. Assistant answers render markdown; user turns stay plain text. */
const MessageView = ({ role, content, modelLabel, toolCalls, streaming = false, steer }: Props) => {
  const { t } = useI18n();
  if (role === 'user' && steer) {
    return (
      <div className="flex flex-col items-end gap-1">
        <p className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-300">
          <CornerDownRight size={12} aria-hidden="true" />
          {t('chat.correction')}
          {steer === 'pending' && <span className="font-normal text-slate-500 dark:text-slate-400">{t('chat.correctionPending')}</span>}
        </p>
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md border border-amber-300 bg-amber-50 px-4 py-2.5 text-[15px] leading-relaxed text-amber-950 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
          {content}
        </div>
      </div>
    );
  }
  if (role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-[var(--accent-600)] px-4 py-2.5 text-[15px] leading-relaxed text-white">
          {content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <img src={LOGO_SRC} alt="" width={28} height={28} className="mt-0.5 h-7 w-7 shrink-0" />
      <div className="min-w-0 flex-1">
        {modelLabel && (
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
            <Sparkles size={12} aria-hidden="true" />
            {modelLabel}
          </p>
        )}
        {toolCalls && <ToolCallList calls={toolCalls} />}
        <div className={`prose-chat text-[15px] text-slate-800 dark:text-slate-200 ${streaming ? 'stream-caret' : ''}`}>
          {content ? <MarkdownBody text={content} /> : streaming ? <span className="sr-only">…</span> : null}
        </div>
      </div>
    </div>
  );
};

export default MessageView;
