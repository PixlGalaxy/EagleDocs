import { memo, useState } from 'react';
import Markdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CircleAlert, CornerDownRight, GitBranch, RotateCcw, Shuffle, Sparkles } from 'lucide-react';
import ModelPicker from './ModelPicker';
import { useI18n } from '../../i18n/I18nContext';
import type { MessageAttachment, ModelOption, ToolCall } from '../../api/types';
import ToolCallList from './ToolCallList';
import { ImageLightbox, MessageAttachments } from './AttachmentViews';
import HawkAvatar from './HawkAvatar';
import { BrandLoaderCycle } from '../ui/BrandLoader';
import { useSmoothText } from './useSmoothText';
import QuestionCard from './QuestionCard';
import HtmlDisplay from './HtmlDisplay';
import { linkedFilesIn } from './fileLinks';
import { FileCards } from './LinkedFiles';
import UserBubble from './UserBubble';
import type { UserQuestion } from '../../api/types';
import { fileUrl, workspaceLinkPath } from './attachments';
import { normalizeMath, useMathPlugins } from './math';
import MermaidDiagram from './MermaidDiagram';

/** The agent's picture tool: shown as a loader square while it works, never as a tool card. */
const IMAGE_TOOL = 'image_generate';

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
  /** Where an applied correction reached the agent ("read after: Searching email"). */
  steerNote?: string;
  /** When a user message was sent (shown inside the bubble, like WhatsApp). */
  sentAt?: string;
  /** Files sent with a user message. */
  attachments?: MessageAttachment[];
  /** The agent asked these with options: shown as a card instead of their text version. */
  questions?: UserQuestion[];
  /** The answer stopped on an error: shown under it. */
  failed?: string;
  /** A later message exists or the agent is working: the questions are read-only. */
  questionsAnswered?: boolean;
  onAnswer?: (text: string) => void;
  /** Interactive pages the agent showed, with the URL each one loads from. */
  displays?: { title: string; src: string }[];
  /** The last answer, finished: try again, with the same model or another one. */
  onRetry?: (modelRef?: string) => void;
  retryOptions?: ModelOption[];
  /** A finished answer: start a fork of the chat up to here. */
  onFork?: () => void;
  /** The student's message: edit it (the agent answers again), and its versions. */
  onEdit?: (text: string) => void;
  version?: { current: number; total: number; onSwitch: (version: number) => void };
}

const FILE_LINK = fileUrl('');
/** Only the student's own files load as pictures by themselves. */
const isOwnFile = (src: unknown) => typeof src === 'string' && src.startsWith(FILE_LINK.slice(0, FILE_LINK.indexOf('?')));

/** Links to workspace files become downloads (pictures load inline); other addresses go through the safe default. */
const urlTransform = (url: string, key: string) => {
  const path = workspaceLinkPath(url);
  return path ? fileUrl(path, key === 'src') : defaultUrlTransform(url);
};

/** A picture from the workspace in an answer (e.g. one the agent made): kept to a readable size, a click shows it whole. */
const AnswerImage = ({ src, alt }: { src: string; alt: string }) => {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={t('chat.openImage', { name: alt || 'image' })} className="my-2 block max-w-full cursor-zoom-in">
        <img src={src} alt={alt} loading="lazy" className="max-h-96 w-auto max-w-full rounded-xl border border-slate-200 object-contain dark:border-slate-700" />
      </button>
      {open && <ImageLightbox src={src} name={alt || 'image'} onClose={() => setOpen(false)} />}
    </>
  );
};

/**
 * Answers and reports share it: links always open in a new tab. Outside
 * pictures become links: an image loads without a click, so injected text
 * could otherwise send data away in its address.
 */
/**
 * `fileCards`: under each paragraph or list item that links to files in the
 * workspace, a small preview card of each (the chat's finished answers).
 */
/** A fenced block's language, e.g. "mermaid" for ```mermaid. */
const fenceLanguage = (node: { children?: unknown[] } | undefined) => {
  const code = node?.children?.[0] as { tagName?: string; properties?: { className?: unknown } } | undefined;
  const classes = code?.tagName === 'code' && Array.isArray(code.properties?.className) ? code.properties.className : [];
  return String(classes.find((c) => String(c).startsWith('language-')) ?? '').slice('language-'.length);
};

/** The text inside a fenced block. */
const fenceText = (node: { children?: unknown[] } | undefined) =>
  ((node?.children?.[0] as { children?: { value?: string }[] } | undefined)?.children ?? []).map((c) => c.value ?? '').join('');

export const MarkdownBody = memo(({ text, fileCards = false }: { text: string; fileCards?: boolean }) => {
  const source = normalizeMath(text);
  const math = useMathPlugins(source);
  return (
    <Markdown
      remarkPlugins={[remarkGfm, ...math.remark]}
      rehypePlugins={math.rehype}
      urlTransform={urlTransform}
      components={{
        // Formulas (KaTeX) and diagrams (```mermaid) render; other code blocks stay code.
        pre: ({ node, children }) => (fenceLanguage(node) === 'mermaid' ? <MermaidDiagram code={fenceText(node).trim()} /> : <pre>{children}</pre>),
        ...(fileCards && {
          p: ({ node, children }) => (
            <>
              <p>{children}</p>
              <FileCards paths={linkedFilesIn(node)} />
            </>
          ),
          li: ({ node, children }) => (
            <li>
              {children}
              <FileCards paths={linkedFilesIn(node)} />
            </li>
          ),
        }),
        a: ({ href, children }) =>
          // An address the transform dropped (an unknown scheme) would open this app again in a new tab: plain text instead.
          !href ? (
            <span>{children}</span>
          ) : isOwnFile(href) ? (
            // The server answers with an attachment: the browser saves it and stays on the chat.
            <a href={href} download>
              {children}
            </a>
          ) : (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        img: ({ src, alt }) =>
          isOwnFile(src) ? (
            <AnswerImage src={src as string} alt={alt ?? ''} />
          ) : (
            <a href={typeof src === 'string' ? src : undefined} target="_blank" rel="noopener noreferrer">
              {alt || 'image'}
            </a>
          ),
      }}
    >
      {source}
    </Markdown>
  );
});

/** One chat turn. Assistant answers render markdown; user turns stay plain text. */
const MessageView = ({
  role,
  content,
  modelLabel,
  toolCalls,
  streaming = false,
  typing = false,
  steer,
  steerNote,
  sentAt,
  attachments,
  questions,
  questionsAnswered = false,
  onAnswer,
  displays,
  onRetry,
  retryOptions,
  onFork,
  failed,
  onEdit,
  version,
}: Props) => {
  const { t } = useI18n();
  const shown = useSmoothText(content, streaming);
  if (role === 'user' && steer) {
    return (
      <div className="flex flex-col items-end gap-1">
        <p className="flex max-w-[85%] items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-300">
          <CornerDownRight size={12} className="shrink-0" aria-hidden="true" />
          {t('chat.correction')}
          {steer === 'pending' && <span className="font-normal text-slate-500 dark:text-slate-400">{t('chat.correctionPending')}</span>}
          {steer === 'applied' && steerNote && <span className="min-w-0 truncate font-normal text-slate-500 dark:text-slate-400">· {steerNote}</span>}
        </p>
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md border border-amber-300 bg-amber-50 px-4 py-2.5 text-[15px] leading-relaxed text-amber-950 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
          {content}
        </div>
      </div>
    );
  }
  if (role === 'user') {
    return (
      <div className="flex flex-col items-end gap-1.5">
        {attachments && attachments.length > 0 && <MessageAttachments items={attachments} />}
        {/* A message can be only files. */}
        {content && <UserBubble content={content} sentAt={sentAt} onEdit={onEdit} version={version} />}
      </div>
    );
  }

  // Pictures being made show as a loader square, not a tool card; a failed one keeps its card so the error shows.
  const drawing = streaming ? (toolCalls ?? []).filter((c) => c.name === IMAGE_TOOL && c.status === 'running') : [];
  const listedCalls = toolCalls?.filter((c) => c.name !== IMAGE_TOOL || c.status === 'error');

  // Nothing to show yet (queued, or a part that only marks where a correction landed): no lone avatar.
  if (!shown && !toolCalls?.length && !typing && !modelLabel && !failed) return null;

  return (
    <div className="flex gap-3">
      <HawkAvatar className="mt-0.5" />
      <div className="min-w-0 flex-1">
        {modelLabel && (
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
            <Sparkles size={12} aria-hidden="true" />
            {modelLabel}
          </p>
        )}
        {listedCalls && listedCalls.length > 0 && <ToolCallList calls={listedCalls} />}
        {drawing.map((call) => (
          // A picture on its way: a square with the SH loader where it will appear.
          <div key={call.id} className="mb-3 flex aspect-square w-64 max-w-full items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800">
            <BrandLoaderCycle size={56} label={t('chat.creatingImage')} />
          </div>
        ))}
        {displays && displays.length > 0 && (
          <div className="mb-3 space-y-3">
            {displays.map((d) => (
              <HtmlDisplay key={d.src} title={d.title} src={d.src} />
            ))}
          </div>
        )}
        {questions?.length ? (
          <QuestionCard questions={questions} answered={questionsAnswered || !onAnswer} onAnswer={(text) => onAnswer?.(text)} />
        ) : (
          shown && (
            <div className="prose-chat text-[15px] text-slate-800 dark:text-slate-200">
              <MarkdownBody text={shown} fileCards={!streaming} />
            </div>
          )
        )}
        {failed && !streaming && (
          <p className="mt-2 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200" role="alert">
            <CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            {failed}
          </p>
        )}
        {(onRetry || onFork) && !streaming && (
          <div className="mt-2 flex items-center gap-1 text-slate-500 dark:text-slate-400">
            {onFork && (
              <button
                type="button"
                onClick={onFork}
                title={t('chat.forkHere')}
                className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-100"
              >
                <GitBranch size={14} aria-hidden="true" />
                {t('chat.fork')}
              </button>
            )}
            {onRetry && (
              <>
                <button
                  type="button"
                  onClick={() => onRetry()}
                  title={t('chat.retry')}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                >
                  <RotateCcw size={14} aria-hidden="true" />
                  {t('chat.retry')}
                </button>
                {retryOptions && retryOptions.length > 0 && (
                  <ModelPicker options={retryOptions} value="" onChange={(ref) => onRetry(ref)} trigger={{ label: t('chat.retryWith'), icon: Shuffle }} />
                )}
              </>
            )}
          </div>
        )}
        {typing && drawing.length === 0 && (
          <div
            className={`${shown ? 'mt-2' : ''} inline-flex rounded-2xl rounded-bl-md bg-slate-100 px-3.5 py-3 text-slate-500 dark:bg-slate-800 dark:text-slate-400`}
            role="status"
          >
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
