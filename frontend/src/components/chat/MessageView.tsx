import { memo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CornerDownRight, Sparkles } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';
import type { ToolCall } from '../../api/types';
import ToolCallList from './ToolCallList';
import { LOGO_SRC } from '../brand';
import { useSmoothText } from './useSmoothText';

interface Props {
  role: 'user' | 'assistant';
  content: string;
  modelLabel?: string | null;
  toolCalls?: ToolCall[];
  /** Text still arriving: revealed at an even pace. */
  streaming?: boolean;
  /** The agent is thinking or working (no new text for a moment): show the typing bubble. */
  typing?: boolean;
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
const MessageView = ({ role, content, modelLabel, toolCalls, streaming = false, typing = false, steer }: Props) => {
  const { t } = useI18n();
  const shown = useSmoothText(content, streaming);
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
        {shown && (
          <div className="prose-chat text-[15px] text-slate-800 dark:text-slate-200">
            <MarkdownBody text={shown} />
          </div>
        )}
        {typing && (
          <div className={`${shown ? 'mt-2' : ''} inline-flex rounded-2xl rounded-bl-md bg-slate-100 px-3.5 py-3 text-slate-500 dark:bg-slate-800 dark:text-slate-400`} role="status">
            <span className="typing-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            <span className="sr-only">{t('chat.typing')}</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default MessageView;
