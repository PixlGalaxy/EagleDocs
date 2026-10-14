import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { BookOpen, CalendarClock, GraduationCap, Map as MapIcon, Menu, Smartphone, Loader2, Plug, CircleAlert } from 'lucide-react';
import { chatApi, modelsApi } from '../../api/chat';
import { ApiError } from '../../api/client';
import type { Approval, Chat, Message, ModelOption, StreamEvent, ToolCall } from '../../api/types';
import { useAuth } from '../../context/AuthContext';
import { useI18n } from '../../i18n/I18nContext';
import type { TranslationKey } from '../../i18n/translations';
import ChatSidebar from './ChatSidebar';
import MessageView from '../../components/chat/MessageView';
import ApprovalCard from '../../components/chat/ApprovalCard';
import Composer from '../../components/chat/Composer';
import ModelPicker from '../../components/chat/ModelPicker';
import Modal from '../../components/ui/Modal';
import { Notice, Skeleton } from '../../components/ui/kit';
import { btn, input } from '../../components/ui/styles';

interface LiveAnswer {
  jobId: string;
  content: string;
  toolCalls: ToolCall[];
  modelLabel: string | null;
  status: 'queued' | 'running' | 'waiting_approval' | 'waiting_mfa';
  queuePosition: number | null;
  mfa: string | null;
  /** Corrections sent while this answer runs. */
  /** `at`: how many tool calls had run when the agent read it, to show it at that point of the answer. */
  steers: { id: string; content: string; applied: boolean; at?: number }[];
  notice: string | null;
}

const SUGGESTIONS: { icon: typeof BookOpen; key: TranslationKey }[] = [
  { icon: CalendarClock, key: 'chat.suggestDue' },
  { icon: BookOpen, key: 'chat.suggestAnnouncements' },
  { icon: GraduationCap, key: 'chat.suggestStudy' },
  { icon: MapIcon, key: 'chat.suggestDegree' },
];

const ChatPage = () => {
  const { chatId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t } = useI18n();

  const [chats, setChats] = useState<Chat[]>([]);
  const [loadingChats, setLoadingChats] = useState(true);
  const [messages, setMessages] = useState<Message[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(!!chatId);
  const [live, setLive] = useState<LiveAnswer | null>(null);
  const [options, setOptions] = useState<ModelOption[] | null>(null);
  const [modelRef, setModelRef] = useState('auto');
  const location = useLocation();
  const [draft, setDraft] = useState<string>(() => (location.state as { prompt?: string } | null)?.prompt ?? '');
  const [error, setError] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [renaming, setRenaming] = useState<Chat | null>(null);
  const [deleting, setDeleting] = useState<Chat | null>(null);

  const closeStream = useRef<(() => void) | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const refreshChats = useCallback(() => {
    chatApi
      .list()
      .then(setChats)
      .catch((err) => setError(err instanceof ApiError ? err.message : t('common.networkError')))
      .finally(() => setLoadingChats(false));
  }, [t]);

  useEffect(() => {
    refreshChats();
    Promise.all([modelsApi.options(), modelsApi.prefs()])
      .then(([opts, prefs]) => {
        setOptions(opts);
        setModelRef(prefs.mode === 'auto' || !prefs.default_model_ref ? 'auto' : prefs.default_model_ref);
      })
      .catch(() => setOptions([]));
    // Only on mount: refreshChats is stable for the page's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onEvent = useCallback(
    (event: StreamEvent, streamChatId: string) => {
      setLive((prev) => {
        if (!prev) return prev;
        switch (event.type) {
          case 'status':
            if (event.status === 'queued' || event.status === 'running' || event.status === 'waiting_approval' || event.status === 'waiting_mfa') {
              return { ...prev, status: event.status, queuePosition: event.queue_position ?? null, mfa: event.status === 'waiting_mfa' ? prev.mfa : null };
            }
            return prev;
          case 'model':
            return { ...prev, modelLabel: event.model_label };
          case 'delta':
            return { ...prev, content: prev.content + event.text, status: 'running' };
          case 'tool_call':
          case 'tool_result': {
            const others = prev.toolCalls.filter((call) => call.id !== event.call.id);
            // Text written before a tool and text written after it are separate paragraphs.
            const content = event.type === 'tool_call' && prev.content && !/\n\s*$/.test(prev.content) ? `${prev.content}\n\n` : prev.content;
            return { ...prev, content, toolCalls: [...others, event.call] };
          }
          case 'mfa_required':
            return { ...prev, status: 'waiting_mfa', mfa: event.message };
          case 'interrupted':
            // A correction cut the answer short; the new one starts from scratch.
            return { ...prev, content: '' };
          case 'notice':
            return { ...prev, notice: event.message };
          case 'steer_applied': {
            const known = prev.steers.some((s) => s.id === event.id);
            return {
              ...prev,
              steers: known
                ? prev.steers.map((s) => (s.id === event.id ? { ...s, applied: true, at: prev.toolCalls.length } : s))
                : [...prev.steers, { id: event.id, content: event.content, applied: true, at: prev.toolCalls.length }],
            };
          }
          default:
            return prev;
        }
      });

      if (event.type === 'approval_required') {
        setApprovals((prev) => [...prev.filter((a) => a.id !== event.approval.id), event.approval]);
      } else if (event.type === 'done') {
        setMessages((prev) => [...prev, event.message]);
        // Decided approvals were only context for the running turn; the tool list keeps the record.
        setApprovals((prev) => prev.filter((a) => a.status === 'pending'));
        setLive(null);
        refreshChats();
        // Reload so corrections sit exactly where the agent took them.
        chatApi
          .get(streamChatId)
          .then(({ messages: saved }) => setMessages(saved))
          .catch(() => undefined);
      } else if (event.type === 'error') {
        setError(event.error);
        setLive(null);
        refreshChats();
      }
    },
    [refreshChats],
  );

  const attach = useCallback(
    (id: string, jobId: string) => {
      closeStream.current?.();
      setLive({ jobId, content: '', toolCalls: [], modelLabel: null, status: 'queued', queuePosition: null, mfa: null, steers: [], notice: null });
      closeStream.current = chatApi.stream(id, jobId, (event) => onEvent(event, id));
    },
    [onEvent],
  );

  // Switching chats resets the view during render (not in an effect), so the
  // old conversation never flashes under the new title.
  const [shownChatId, setShownChatId] = useState(chatId);
  if (shownChatId !== chatId) {
    setShownChatId(chatId);
    setLive(null);
    setError('');
    setApprovals([]);
    setMessages([]);
    setLoadingMessages(!!chatId);
  }

  // Load the selected chat and resume its job if one is still running server-side.
  useEffect(() => {
    closeStream.current?.();
    closeStream.current = null;
    if (!chatId) return;
    let cancelled = false;
    chatApi
      .get(chatId)
      .then(({ chat, messages, pending_approvals }) => {
        if (cancelled) return;
        setMessages(messages);
        setApprovals(pending_approvals);
        if (chat.model_ref) setModelRef(chat.model_ref);
        if (chat.active_job_id) attach(chat.id, chat.active_job_id);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) navigate('/chat', { replace: true });
        else setError(err instanceof ApiError ? err.message : t('common.networkError'));
      })
      .finally(() => !cancelled && setLoadingMessages(false));
    return () => {
      cancelled = true;
    };
  }, [chatId, attach, navigate, t]);

  useEffect(() => () => closeStream.current?.(), []);

  // "Thinking" dots come back when no new text arrived for a moment (a tool is running, the model is working).
  // The text that last went quiet; any new text makes it stale, so the dots hide until the next pause.
  const [quietAt, setQuietAt] = useState<string | null>(null);
  const liveContent = live?.content ?? null;
  const quiet = liveContent !== null && quietAt === liveContent;
  useEffect(() => {
    if (liveContent === null) return;
    const timer = setTimeout(() => setQuietAt(liveContent), 900);
    return () => clearTimeout(timer);
  }, [liveContent]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, live?.content, live?.toolCalls.length, approvals.length]);

  const send = async (text = draft) => {
    const content = text.trim();
    if (!content || live) return;
    setError('');
    setDraft('');
    try {
      if (!chatId) {
        const chat = await chatApi.create({ model_ref: modelRef });
        await chatApi.send(chat.id, { content, model_ref: modelRef });
        // The loader effect picks up the running job from the new chat.
        navigate(`/chat/${chat.id}`);
        refreshChats();
        return;
      }
      const { job_id, message } = await chatApi.send(chatId, { content, model_ref: modelRef });
      setMessages((prev) => [...prev, message]);
      attach(chatId, job_id);
    } catch (err) {
      setDraft(content);
      setError(err instanceof ApiError ? err.message : t('common.networkError'));
    }
  };

  /** Sends the draft as a correction to the running answer. */
  const steer = async () => {
    const content = draft.trim();
    if (!content || !live) return;
    setDraft('');
    try {
      const sent = await chatApi.steer(live.jobId, content);
      setLive((prev) => {
        if (!prev || prev.steers.some((s) => s.id === sent.id)) return prev;
        return { ...prev, steers: [...prev.steers, { id: sent.id, content: sent.content, applied: false }] };
      });
    } catch (err) {
      setDraft(content);
      setError(err instanceof ApiError ? err.message : t('common.networkError'));
    }
  };

  const stop = async () => {
    if (!live) return;
    try {
      await chatApi.cancel(live.jobId);
    } catch {
      // The stream reports the final state either way.
    }
  };

  const decide = async (approval: Approval, approve: boolean) => {
    await chatApi.decide(approval.id, approve);
    setApprovals((prev) => prev.map((a) => (a.id === approval.id ? { ...a, status: approve ? 'approved' : 'rejected' } : a)));
  };

  const saveRename = async (e: FormEvent) => {
    e.preventDefault();
    if (!renaming) return;
    const updated = await chatApi.rename(renaming.id, renaming.title.trim() || t('chat.untitled'));
    setChats((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    setRenaming(null);
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    await chatApi.remove(deleting.id);
    setChats((prev) => prev.filter((c) => c.id !== deleting.id));
    if (deleting.id === chatId) navigate('/chat');
    setDeleting(null);
  };

  const activeChat = chats.find((c) => c.id === chatId);
  const noModels = options !== null && options.length === 0;
  const showEmpty = !chatId && !loadingMessages;

  return (
    <div className="flex min-h-0 flex-1">
      <title>{activeChat ? `${activeChat.title} - EagleDocs` : `${t('nav.chat')} - EagleDocs`}</title>

      {/* Desktop sidebar */}
      <aside className="hidden w-72 shrink-0 border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 md:block">
        <ChatSidebar chats={chats} loading={loadingChats} activeId={chatId} onNew={() => navigate('/chat')} onRename={setRenaming} onDelete={setDeleting} />
      </aside>

      {/* Mobile drawer */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setSidebarOpen(false)} aria-hidden="true" />
          <aside className="absolute inset-y-0 left-0 w-[85vw] max-w-xs overscroll-contain bg-white shadow-xl dark:bg-slate-900">
            <ChatSidebar
              chats={chats}
              loading={loadingChats}
              activeId={chatId}
              onNew={() => {
                setSidebarOpen(false);
                navigate('/chat');
              }}
              onRename={setRenaming}
              onDelete={setDeleting}
              onClose={() => setSidebarOpen(false)}
            />
          </aside>
        </div>
      )}

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-slate-200 bg-white/70 px-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/70 sm:px-4">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            aria-label={t('chat.openList')}
            className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 md:hidden"
          >
            <Menu size={20} />
          </button>
          <ModelPicker options={options ?? []} value={modelRef} onChange={setModelRef} disabled={!!live} />
          <p className="ml-auto hidden truncate text-sm text-slate-500 dark:text-slate-400 sm:block">{activeChat?.title}</p>
        </header>

        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6">
            {noModels && (
              <Notice tone="warning" icon={Plug}>
                {t('chat.noModels')}{' '}
                <Link to="/settings?section=models" className="font-medium underline underline-offset-2">
                  {t('chat.noModelsLink')}
                </Link>
              </Notice>
            )}

            {showEmpty && (
              <div className="pt-[8vh]">
                <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white sm:text-3xl">
                  {t('chat.greeting', { name: user?.display_name?.split(' ')[0] || user?.username || '' })}
                </h1>
                <p className="mt-2 text-slate-600 dark:text-slate-400">{t('chat.greetingSub')}</p>
                <div className="mt-8 grid gap-2 sm:grid-cols-2">
                  {SUGGESTIONS.map(({ icon: Icon, key }) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => void send(t(key))}
                      className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left text-sm text-slate-700 transition hover:border-[var(--accent-300)] hover:bg-[var(--accent-50)]/40 active:scale-[0.99] dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-[var(--accent-500)]/50 dark:hover:bg-[var(--accent-500)]/5"
                    >
                      <Icon size={18} className="mt-0.5 shrink-0 text-[var(--accent-600)] dark:text-[var(--accent-300)]" aria-hidden="true" />
                      {t(key)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {loadingMessages && (
              <div className="space-y-6" aria-busy="true">
                <Skeleton className="ml-auto h-10 w-2/3 rounded-2xl" />
                <div className="space-y-2">
                  <Skeleton className="h-4 w-11/12" />
                  <Skeleton className="h-4 w-4/5" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              </div>
            )}

            {messages.map((m) => (
              <MessageView key={m.id} role={m.role} content={m.content} modelLabel={m.model_label} toolCalls={m.tool_calls} steer={m.steer ? 'applied' : undefined} />
            ))}

            {/* Decided approvals shrink to one line above the answer in progress. */}
            {approvals.some((a) => a.status !== 'pending') && (
              <div className="space-y-1.5">
                {approvals
                  .filter((a) => a.status !== 'pending')
                  .map((approval) => (
                    <ApprovalCard key={approval.id} approval={approval} />
                  ))}
              </div>
            )}

            {live && (
              <div aria-live="polite">
                {live.status === 'queued' && (
                  <p className="mb-3 flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                    <Loader2 size={15} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                    {live.queuePosition ? t('chat.queued', { position: live.queuePosition }) : t('chat.starting')}
                  </p>
                )}
                {live.status === 'waiting_mfa' && (
                  <div className="mb-4">
                    <Notice tone="accent" icon={Smartphone}>
                      <p className="font-medium">{t('chat.mfaTitle')}</p>
                      <p className="mt-0.5">{live.mfa ?? t('chat.mfaBody')}</p>
                    </Notice>
                  </div>
                )}
                {live.notice && (
                  <div className="mb-4">
                    <Notice tone="warning" icon={CircleAlert}>
                      {live.notice}
                    </Notice>
                  </div>
                )}
                {/* The answer in progress, cut where the agent read each correction. */}
                {(() => {
                  const applied = live.steers.filter((st) => st.applied).sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
                  let from = 0;
                  const parts = applied.map((st, i) => {
                    const calls = live.toolCalls.slice(from, st.at ?? from);
                    from = st.at ?? from;
                    return (
                      <div key={st.id} className="space-y-6">
                        {(calls.length > 0 || i === 0) && <MessageView role="assistant" content="" modelLabel={i === 0 ? live.modelLabel : null} toolCalls={calls} />}
                        <MessageView role="user" content={st.content} steer="applied" />
                      </div>
                    );
                  });
                  return (
                    <div className="space-y-6">
                      {parts}
                      <MessageView
                        role="assistant"
                        content={live.content}
                        modelLabel={applied.length ? null : live.modelLabel}
                        toolCalls={live.toolCalls.slice(from)}
                        streaming={live.status === 'running'}
                        typing={live.status === 'running' && (!live.content || quiet)}
                      />
                    </div>
                  );
                })()}
              </div>
            )}

            {approvals
              .filter((a) => a.status === 'pending')
              .map((approval) => (
                <ApprovalCard key={approval.id} approval={approval} onDecide={(approve) => decide(approval, approve)} />
              ))}

            {error && (
              <Notice tone="danger" icon={CircleAlert}>
                {error}
              </Notice>
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        <div className="shrink-0 px-4 pb-4 pt-2">
          {/* Corrections the agent has not read yet wait here, next to where they were written. */}
          {live && live.steers.some((st) => !st.applied) && (
            <div className="mx-auto mb-2 w-full max-w-3xl space-y-2">
              {live.steers
                .filter((st) => !st.applied)
                .map((st) => (
                  <MessageView key={st.id} role="user" content={st.content} steer="pending" />
                ))}
            </div>
          )}
          <Composer
            value={draft}
            onChange={setDraft}
            onSubmit={() => void send()}
            onStop={() => void stop()}
            onSteer={() => void steer()}
            busy={!!live}
          />
        </div>
      </section>

      {renaming && (
        <Modal title={t('chat.rename')} onClose={() => setRenaming(null)}>
          <form onSubmit={(e) => void saveRename(e)} className="space-y-5">
            <label className="sr-only" htmlFor="rename-chat">
              {t('chat.rename')}
            </label>
            <input id="rename-chat" autoFocus value={renaming.title} onChange={(e) => setRenaming({ ...renaming, title: e.target.value })} className={input} maxLength={120} />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setRenaming(null)} className={btn.secondary}>
                {t('common.cancel')}
              </button>
              <button type="submit" className={btn.primary}>
                {t('common.save')}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {deleting && (
        <Modal title={t('chat.deleteTitle')} onClose={() => setDeleting(null)}>
          <p className="text-sm text-slate-600 dark:text-slate-300">{t('chat.deleteBody', { title: deleting.title })}</p>
          <div className="mt-6 flex justify-end gap-2">
            <button type="button" onClick={() => setDeleting(null)} className={btn.secondary}>
              {t('common.cancel')}
            </button>
            <button type="button" onClick={() => void confirmDelete()} className={btn.danger}>
              {t('chat.delete')}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default ChatPage;
