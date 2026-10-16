import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowDown, BookOpen, CalendarClock, Folder, FolderOpen, GraduationCap, Map as MapIcon, Menu, PanelLeftClose, PanelLeftOpen, X, Smartphone, Loader2, Plug, CircleAlert } from 'lucide-react';
import { chatApi, modelsApi } from '../../api/chat';
import { ApiError, apiUrl } from '../../api/client';
import type { Approval, BackgroundJob, BusyInput, Chat, ContextUsage, Message, ModelOption, PlanStep, ReasoningLevel, StreamEvent, ToolCall, UserModelPrefs, WorkspaceEntry } from '../../api/types';
import { useAuth } from '../../context/AuthContext';
import { authApi } from '../../api/auth';
import { useI18n } from '../../i18n/I18nContext';
import type { TranslationKey } from '../../i18n/translations';
import ChatSidebar from './ChatSidebar';
import MessageView from '../../components/chat/MessageView';
import ApprovalCard from '../../components/chat/ApprovalCard';
import BackgroundReport from '../../components/chat/BackgroundReport';
import BackgroundTasks from '../../components/chat/BackgroundTasks';
import PlanDock from '../../components/chat/PlanDock';
import { applySubagentEvent, mergeCall } from '../../components/chat/subagents';
import Composer from '../../components/chat/Composer';
import ModelPicker from '../../components/chat/ModelPicker';
import ReasoningPicker from '../../components/chat/ReasoningPicker';
import ContextRing from '../../components/chat/ContextRing';
import { REASONING_LEVELS } from '../../components/chat/toolbar';
import { useDraftAttachments } from '../../components/chat/useDraftAttachments';
import { toolLabel } from '../../components/chat/toolLabels';
import { MAX_ATTACHMENTS } from '../../components/chat/attachments';
import WorkspacePanel from './WorkspacePanel';
import ResizableDock from './ResizableDock';
import ChatInfoDialog from './ChatInfoDialog';
import ChooseModelDialog from './ChooseModelDialog';
import { CHAT_COLUMN } from '../../components/chat/layout';
import Modal from '../../components/ui/Modal';
import Toast from '../../components/ui/Toast';
import { useConfirm } from '../../components/ui/confirm';
import { useMediaQuery } from '../../components/useMediaQuery';
import { Notice, Skeleton } from '../../components/ui/kit';
import { btn, input } from '../../components/ui/styles';
import BrandLoader from '../../components/ui/BrandLoader';

interface LiveAnswer {
  jobId: string;
  content: string;
  toolCalls: ToolCall[];
  modelLabel: string | null;
  /** `finishing`: the answer is done and stays on screen until the saved version replaces it. */
  status: 'queued' | 'running' | 'waiting_approval' | 'waiting_mfa' | 'finishing';
  queuePosition: number | null;
  mfa: string | null;
  /** Corrections sent while this answer runs. */
  /** `at`: how many tool calls had run when the agent read it, to show it at that point of the answer. */
  steers: { id: string; content: string; applied: boolean; at?: number }[];
  notice: string | null;
}

/** Adds a message unless the list has it already (a replayed event, a reload that got there first). */
const withMessage = (list: Message[], message: Message) => (list.some((m) => m.id === message.id) ? list : [...list, message]);

/** The workspace panel's open state on wide screens, kept per browser. */
const FILES_PANEL_KEY = 'studyhawk.chat.filesPanel';
const WIDE = '(min-width: 1024px)';
/** How long a finished plan stays above the message box before it slides away. */
const PLAN_STAYS_MS = 6000;

/** The thinking effort, kept per browser. */
const REASONING_KEY = 'studyhawk.chat.reasoning';

function storedReasoning(): ReasoningLevel {
  try {
    const value = localStorage.getItem(REASONING_KEY);
    return REASONING_LEVELS.find((level) => level === value) ?? 'default';
  } catch {
    return 'default';
  }
}

/** The chat list on wide screens: shown unless the student hid it (remembered in this browser). */
const CHAT_LIST_KEY = 'studyhawk.chatList';
function storedListHidden(): boolean {
  try {
    return localStorage.getItem(CHAT_LIST_KEY) === 'hidden';
  } catch {
    return false;
  }
}

function storedFilesPanel(): boolean {
  try {
    return localStorage.getItem(FILES_PANEL_KEY) === 'open';
  } catch {
    return false;
  }
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
  const { user, updateUser } = useAuth();
  const { t } = useI18n();

  const [chats, setChats] = useState<Chat[]>([]);
  const [loadingChats, setLoadingChats] = useState(true);
  const [messages, setMessages] = useState<Message[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  /** Helper agents working in the background for this chat. */
  const [background, setBackground] = useState<BackgroundJob[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(!!chatId);
  const [live, setLive] = useState<LiveAnswer | null>(null);
  /** The agent's plan for the answer in progress: shown above the message box, and a few seconds after it ends. */
  const [plan, setPlan] = useState<{ title?: string; steps: PlanStep[]; leaving: boolean } | null>(null);
  useEffect(() => {
    if (!plan || live) return;
    // The answer ended: the plan stays a moment (all filled in), then slides away.
    const stay = window.setTimeout(() => setPlan((p) => (p ? { ...p, leaving: true } : p)), PLAN_STAYS_MS);
    const gone = window.setTimeout(() => setPlan(null), PLAN_STAYS_MS + 320);
    return () => {
      window.clearTimeout(stay);
      window.clearTimeout(gone);
    };
    // Only the answer ending (or a new plan) restarts the countdown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live === null, plan?.steps]);
  // Screen readers hear one line when an answer finishes, not every piece of it as it streams.
  const [answered, setAnswered] = useState(false);
  if (live && !answered) setAnswered(true);
  const announcement = answered && !live ? t('chat.answerReady') : '';
  const [options, setOptions] = useState<ModelOption[] | null>(null);
  const [modelRef, setModelRef] = useState('auto');
  const [prefs, setPrefs] = useState<UserModelPrefs | null>(null);
  /** A message that found no model to answer it (Auto with nothing to pick): waits for a default model. */
  const [needsModel, setNeedsModel] = useState<string | null>(null);
  const [reasoning, setReasoning] = useState<ReasoningLevel>(storedReasoning);
  const location = useLocation();
  const [draft, setDraft] = useState<string>(() => (location.state as { prompt?: string } | null)?.prompt ?? '');
  const [error, setError] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // The docked chat list exists only on md screens and up; phones use the drawer (one list at a time).
  const docked = useMediaQuery('(min-width: 768px)');
  const [renaming, setRenaming] = useState<Chat | null>(null);
  const [deleting, setDeleting] = useState<Chat | null>(null);
  const [infoFor, setInfoFor] = useState<Chat | null>(null);
  /** How full the model's context is (last run, then live while one runs). */
  const [context, setContext] = useState<ContextUsage | null>(null);
  const [compacting, setCompacting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const ask = useConfirm();
  const attachments = useDraftAttachments();
  /** Workspace panel: docked on wide screens (remembered), a drawer on phones (always starts closed). */
  const [filesDocked, setFilesDocked] = useState(storedFilesPanel);
  const [listHidden, setListHidden] = useState(storedListHidden);
  const toggleList = () => {
    const next = !listHidden;
    setListHidden(next);
    try {
      localStorage.setItem(CHAT_LIST_KEY, next ? 'hidden' : 'shown');
    } catch {
      // Private mode: it just is not remembered.
    }
  };
  const [filesDrawer, setFilesDrawer] = useState(false);
  /** Bumped when a run ends, so the files panel reloads what the agent may have written. */
  const [filesVersion, setFilesVersion] = useState(0);

  const closeStream = useRef<(() => void) | null>(null);
  /** The job the live answer follows, and jobs already finished (their row can still read as running for a moment). */
  const liveJob = useRef<string | null>(null);
  const finishedJobs = useRef(new Set<string>());
  const attachRef = useRef<(chatId: string, jobId: string) => void>(() => undefined);
  /** Jobs where the agent read a correction: their saved answer is laid out differently from the live one. */
  const steeredJobs = useRef(new Set<string>());
  /** The chat on screen, so late responses for another chat are dropped. */
  const currentChat = useRef(chatId);
  const sending = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  /** Follow new content only while the reader sits at the bottom; scrolling up lets them read in peace. */
  const stuck = useRef(true);
  const [awayFromBottom, setAwayFromBottom] = useState(false);

  const refreshChats = useCallback(() => {
    chatApi
      .list()
      .then(setChats)
      .catch((err) => setError(err instanceof ApiError ? err.message : t('common.networkError')))
      .finally(() => setLoadingChats(false));
  }, [t]);

  // The list keeps up by itself: often while some chat is working (its spinner, then its unread dot), rarely otherwise.
  const anyWorking = chats.some((c) => c.working || c.active_job_id);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') refreshChats();
    }, anyWorking ? 4000 : 20000);
    const onVisible = () => document.visibilityState === 'visible' && refreshChats();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [anyWorking, refreshChats]);

  useEffect(() => {
    refreshChats();
    Promise.all([modelsApi.options(), modelsApi.prefs()])
      .then(([opts, prefs]) => {
        setOptions(opts);
        setPrefs(prefs);
        setModelRef(prefs.mode === 'auto' || !prefs.default_model_ref ? 'auto' : prefs.default_model_ref);
      })
      .catch(() => setOptions([]));
    // Only on mount: refreshChats is stable for the page's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Reloads the saved conversation and the background helpers, and follows a
   * job that started on its own (the turn that answers with background reports).
   */
  const reload = useCallback(
    (id: string): Promise<boolean> =>
      chatApi
        .get(id)
        .then(({ chat, messages: saved, background_jobs, context: usage }) => {
          if (currentChat.current !== id) return true;
          setMessages(saved);
          setBackground(background_jobs);
          if (usage) setContext(usage);
          if (chat.active_job_id && !liveJob.current && !finishedJobs.current.has(chat.active_job_id)) attachRef.current(id, chat.active_job_id);
          return true;
        })
        .catch(() => false),
    [],
  );

  const onEvent = useCallback(
    (event: StreamEvent, streamChatId: string, jobId: string) => {
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
            // A result updates its call in place: calls keep their order (and corrections their place).
            const known = prev.toolCalls.some((call) => call.id === event.call.id);
            const toolCalls = known ? prev.toolCalls.map((call) => (call.id === event.call.id ? mergeCall(call, event.call) : call)) : [...prev.toolCalls, event.call];
            // Text written before a tool and text written after it are separate paragraphs.
            const content = event.type === 'tool_call' && prev.content && !/\n\s*$/.test(prev.content) ? `${prev.content}\n\n` : prev.content;
            return { ...prev, content, toolCalls };
          }
          case 'subagent':
            return {
              ...prev,
              toolCalls: prev.toolCalls.map((call) =>
                call.id === event.parent_call_id ? { ...call, subagents: applySubagentEvent(call.subagents ?? [], event) } : call,
              ),
            };
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

      if (event.type === 'context') {
        setContext({ used: event.used, window: event.window });
      } else if (event.type === 'plan') {
        setPlan({ title: event.title, steps: event.steps, leaving: false });
      } else if (event.type === 'steer_applied') {
        steeredJobs.current.add(jobId);
      } else if (event.type === 'approval_required') {
        setApprovals((prev) => [...prev.filter((a) => a.id !== event.approval.id), event.approval]);
      } else if (event.type === 'background_results') {
        setMessages((prev) => withMessage(prev, event.message));
      } else if (event.type === 'tool_result' && event.call.name === 'agent_delegate' && event.call.args.background === true) {
        // Helpers went to the background: show them now, not when this answer ends.
        chatApi
          .get(streamChatId)
          .then(({ background_jobs }) => setBackground(background_jobs))
          .catch(() => undefined);
      } else if (event.type === 'done') {
        finishedJobs.current.add(jobId);
        liveJob.current = null;
        // Decided approvals were only context for the running turn; the tool list keeps the record.
        setApprovals((prev) => prev.filter((a) => a.status === 'pending'));
        setFilesVersion((v) => v + 1);
        const finish = () => setLive((cur) => (cur?.jobId === jobId ? null : cur));
        if (steeredJobs.current.has(jobId)) {
          // The saved answer is split where the agent read each correction: keep the live one
          // until that version arrives, instead of flashing the answer without them.
          setLive((cur) => (cur?.jobId === jobId ? { ...cur, status: 'finishing' } : cur));
          void reload(streamChatId).then((ok) => {
            if (!ok && currentChat.current === streamChatId) setMessages((prev) => withMessage(prev, event.message));
            finish();
            // After the reload, which marks the chat read: no unread dot for the answer being watched.
            refreshChats();
          });
        } else {
          setMessages((prev) => withMessage(prev, event.message));
          finish();
          void reload(streamChatId).then(refreshChats);
        }
      } else if (event.type === 'error') {
        finishedJobs.current.add(jobId);
        liveJob.current = null;
        setError(event.error);
        setLive(null);
        refreshChats();
        // Whatever the agent saved before failing replaces the live view.
        void reload(streamChatId);
      }
    },
    [refreshChats, reload],
  );

  const attach = useCallback(
    (id: string, jobId: string) => {
      closeStream.current?.();
      liveJob.current = jobId;
      setLive({ jobId, content: '', toolCalls: [], modelLabel: null, status: 'queued', queuePosition: null, mfa: null, steers: [], notice: null });
      closeStream.current = chatApi.stream(id, jobId, (event) => onEvent(event, id, jobId));
    },
    [onEvent],
  );
  useEffect(() => {
    attachRef.current = attach;
  }, [attach]);

  // Background helpers finished: their reports and the answer that uses them come next.
  const onBackgroundFinished = useCallback(() => {
    if (chatId) void reload(chatId);
  }, [chatId, reload]);

  // Switching chats resets the view during render (not in an effect), so the
  // old conversation never flashes under the new title.
  const [shownChatId, setShownChatId] = useState(chatId);
  if (shownChatId !== chatId) {
    setShownChatId(chatId);
    setLive(null);
    setPlan(null);
    setError('');
    setApprovals([]);
    setBackground([]);
    setMessages([]);
    setLoadingMessages(!!chatId);
    setAwayFromBottom(false);
    setContext(null);
    setCompacting(false);
  }

  // Load the selected chat and resume its job if one is still running server-side.
  useEffect(() => {
    closeStream.current?.();
    closeStream.current = null;
    liveJob.current = null;
    currentChat.current = chatId;
    // A chat opens at its latest message.
    stuck.current = true;
    if (!chatId) return;
    let cancelled = false;
    chatApi
      .get(chatId)
      .then(({ chat, messages, pending_approvals, background_jobs, context: usage }) => {
        if (cancelled) return;
        setMessages(messages);
        setApprovals(pending_approvals);
        setBackground(background_jobs);
        setContext(usage ?? null);
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

  // Keeps the latest message in view whenever anything changes size: new text (also while it is
  // revealed letter by letter), tool calls, approvals, or the composer area growing.
  useEffect(() => {
    const el = scrollRef.current;
    const content = contentRef.current;
    if (!el || !content) return;
    const observer = new ResizeObserver(() => {
      if (stuck.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(el);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 64;
    stuck.current = atBottom;
    setAwayFromBottom(!atBottom);
  };

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (!el) return;
    stuck.current = true;
    el.scrollTop = el.scrollHeight;
  };

  // Escape closes the drawers (chat list, files) on phones.
  useEffect(() => {
    if (!sidebarOpen && !filesDrawer) return;
    const onKey = (e: KeyboardEvent) => {
      // A dialog on top (a file preview) closes first.
      if (e.key !== 'Escape' || document.querySelector('[aria-modal="true"]')) return;
      setSidebarOpen(false);
      setFilesDrawer(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [sidebarOpen, filesDrawer]);

  /** The thinking selector shows for Auto and for models that take a reasoning effort. */
  const selectedModel = options?.find((o) => o.ref === modelRef);
  const showReasoning = modelRef === 'auto' || !!selectedModel?.reasoning;
  const effort = showReasoning && reasoning !== 'default' ? reasoning : undefined;

  const send = async (text = draft, withModel = modelRef) => {
    const content = text.trim();
    let created: string | null = null;
    const files = attachments.paths;
    // `sending` blocks a second send (a double-clicked suggestion) before the job exists.
    if ((!content && !files.length) || attachments.uploading || live || sending.current) return;
    sending.current = true;
    setError('');
    setDraft('');
    scrollToBottom();
    try {
      if (!chatId) {
        const chat = await chatApi.create({ model_ref: withModel });
        created = chat.id;
        await chatApi.send(chat.id, { content, model_ref: withModel, ...(files.length ? { attachments: files } : {}), ...(effort ? { reasoning: effort } : {}) });
        attachments.clear();
        // The loader effect picks up the running job from the new chat.
        navigate(`/chat/${chat.id}`);
        refreshChats();
        return;
      }
      const { job_id, message } = await chatApi.send(chatId, {
        content,
        model_ref: withModel,
        ...(files.length ? { attachments: files } : {}),
        ...(effort ? { reasoning: effort } : {}),
      });
      attachments.clear();
      setMessages((prev) => withMessage(prev, message));
      attach(chatId, job_id);
    } catch (err) {
      setDraft(content);
      if (err instanceof ApiError && err.code === 'models.chooseDefault') {
        // Nothing was saved in it: the empty chat made for this message goes, and the student picks a model.
        if (created) void chatApi.remove(created).catch(() => undefined);
        setNeedsModel(content);
        return;
      }
      setError(err instanceof ApiError ? err.message : t('common.networkError'));
    } finally {
      sending.current = false;
    }
  };

  /** The default model picked in the popup: saved for every new chat, used for this chat, and the message goes. */
  const pickDefaultModel = async (ref: string) => {
    try {
      setPrefs(await modelsApi.savePrefs({ mode: 'manual', default_model_ref: ref, auto_map: prefs?.auto_map ?? {} }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.networkError'));
      return;
    }
    setModelRef(ref);
    const text = needsModel ?? draft;
    setNeedsModel(null);
    await send(text, ref);
  };

  /** A message written while the agent worked (queue or interrupt mode), sent as soon as the answer ends. */
  const [queued, setQueued] = useState<string | null>(null);
  const busyMode = user?.busy_input ?? 'steer';
  // Picked in the composer while it works: the student's setting, so the next chat starts with it.
  const changeBusyMode = (mode: BusyInput) => {
    if (!user) return;
    const before = user;
    updateUser({ ...user, busy_input: mode });
    authApi.appearance({ busy_input: mode }).then(updateUser, () => updateUser(before));
  };
  useEffect(() => {
    if (live || !queued || sending.current) return;
    const text = queued;
    setQueued(null);
    void send(text);
    // send reads the current chat; it only needs to run when the answer ends.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, queued]);

  /** Enter while the agent works, by the student's setting: correct it, queue the message, or stop it and send. */
  const busySubmit = () => {
    if (busyMode === 'steer') return void steer();
    const content = draft.trim();
    if (!content) return;
    setDraft('');
    setQueued((prev) => (prev ? `${prev}\n\n${content}` : content));
    if (busyMode === 'interrupt') void stop();
  };

  /** While a fork is being made (its files copied): a popup that blocks other clicks. */
  const [forking, setForking] = useState(false);

  /** A fork of a chat (up to an answer, or its last one) opens right away. */
  const forkChat = async (id: string, messageId?: string) => {
    if (forking) return;
    setError('');
    setForking(true);
    try {
      const forked = await chatApi.fork(id, messageId);
      refreshChats();
      navigate(`/chat/${forked.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.networkError'));
    } finally {
      setForking(false);
    }
  };

  /** Edits one of the student's messages: the chat continues from the new text (the old version stays reachable). */
  const editMessage = async (messageId: string, content: string) => {
    if (!chatId || live || sending.current) return;
    sending.current = true;
    setError('');
    try {
      await chatApi.editMessage(chatId, messageId, { content, model_ref: modelRef, ...(effort ? { reasoning: effort } : {}) });
      // The reload shows the new version and follows its answer.
      await reload(chatId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.networkError'));
    } finally {
      sending.current = false;
    }
  };

  /** < n/m >: shows another version of an edited message. */
  const switchVersion = async (messageId: string, version: number) => {
    if (!chatId || live) return;
    try {
      await chatApi.switchVersion(chatId, messageId, version);
      await reload(chatId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.networkError'));
    }
  };

  /** Try again: the last answer is replaced by a new one, by `retryModel` when given (this answer only). */
  const regenerate = async (retryModel?: string) => {
    if (!chatId || live || sending.current) return;
    sending.current = true;
    setError('');
    try {
      const { job_id } = await chatApi.regenerate(chatId, { ...(retryModel && { model_ref: retryModel }), ...(effort ? { reasoning: effort } : {}) });
      // The old answer goes: everything after the student's last message.
      setMessages((prev) => {
        const lastUser = prev.map((m) => m.role).lastIndexOf('user');
        return lastUser >= 0 ? prev.slice(0, lastUser + 1) : prev;
      });
      attach(chatId, job_id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.networkError'));
    } finally {
      sending.current = false;
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

  const chooseReasoning = (level: ReasoningLevel) => {
    setReasoning(level);
    try {
      localStorage.setItem(REASONING_KEY, level);
    } catch {
      // Private mode: it just is not remembered.
    }
  };

  /** Summarizes the older messages (after a confirm); the visible chat stays the same. */
  const compact = () => {
    const id = chatId;
    if (!id || live || compacting) return;
    ask(
      () => {
        setCompacting(true);
        chatApi
          .compact(id)
          .then(({ context: usage, summarized }) => {
            if (currentChat.current !== id) return;
            setContext(usage);
            setToast(t('chat.compacted', { count: summarized }));
          })
          .catch((err) => {
            if (currentChat.current === id) setError(err instanceof ApiError ? err.message : t('common.networkError'));
          })
          .finally(() => {
            if (currentChat.current === id) setCompacting(false);
          });
      },
      { title: t('chat.compactTitle'), body: t('chat.compactBody'), confirmLabel: t('chat.compact'), tone: 'primary' },
    );
  };

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  const decide = async (approval: Approval, approve: boolean) => {
    try {
      await chatApi.decide(approval.id, approve);
      setApprovals((prev) => prev.map((a) => (a.id === approval.id ? { ...a, status: approve ? 'approved' : 'rejected' } : a)));
    } catch (err) {
      // The card stays pending, so the student can try again.
      setError(err instanceof ApiError ? err.message : t('common.networkError'));
    }
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

  const toggleFiles = () => {
    // Phones get a drawer; wide screens dock the panel and remember it.
    if (!window.matchMedia(WIDE).matches) {
      setFilesDrawer(true);
      return;
    }
    const next = !filesDocked;
    setFilesDocked(next);
    try {
      localStorage.setItem(FILES_PANEL_KEY, next ? 'open' : 'closed');
    } catch {
      // Private mode: it just is not remembered.
    }
  };

  const attachFromWorkspace = (entry: WorkspaceEntry) => {
    if (!attachments.addExisting(entry)) setError(t('chat.attachLimit', { count: MAX_ATTACHMENTS }));
    setFilesDrawer(false);
  };

  /** Where a correction reached the agent: after the last step it had taken. */
  const steerNote = (calls: ToolCall[] | undefined) => {
    const last = calls?.at(-1);
    return last ? t('chat.correctionReadAfter', { step: toolLabel(last.name, t) }) : t('chat.correctionReadStart');
  };

  const activeChat = chats.find((c) => c.id === chatId);
  const noModels = options !== null && options.length === 0;
  const showEmpty = !chatId && !loadingMessages;

  return (
    <div className="flex min-h-0 flex-1">
      <title>{activeChat ? `${activeChat.title} - StudyHawk` : `${t('nav.chat')} - StudyHawk`}</title>
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      {/* Desktop sidebar, unless hidden for a wider chat */}
      {docked && !listHidden && (
        <ResizableDock
          side="left"
          storageKey="studyhawk.chatListWidth"
          defaultWidth={288}
          minWidth={220}
          maxWidth={440}
          label={t('chat.resizeList')}
          className="hidden border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 md:block"
        >
          <ChatSidebar chats={chats} loading={loadingChats} activeId={chatId} onNew={() => navigate('/chat')} onRename={setRenaming} onInfo={setInfoFor} onFork={(c) => void forkChat(c.id)} onDelete={setDeleting} />
        </ResizableDock>
      )}

      {/* Mobile drawer */}
      {sidebarOpen && !docked && (
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
              onInfo={setInfoFor}
              onFork={(c) => {
                setSidebarOpen(false);
                void forkChat(c.id);
              }}
              onDelete={setDeleting}
              onClose={() => setSidebarOpen(false)}
            />
          </aside>
        </div>
      )}

      <section data-chat-column className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-slate-200 bg-white/70 px-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/70 sm:px-4">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            aria-label={t('chat.openList')}
            className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 md:hidden"
          >
            <Menu size={20} />
          </button>
          <button
            type="button"
            onClick={toggleList}
            aria-label={listHidden ? t('chat.showList') : t('chat.hideList')}
            title={listHidden ? t('chat.showList') : t('chat.hideList')}
            aria-pressed={!listHidden}
            className="hidden rounded-lg p-2 text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 md:inline-flex"
          >
            {listHidden ? <PanelLeftOpen size={18} aria-hidden="true" /> : <PanelLeftClose size={18} aria-hidden="true" />}
          </button>
          <p className="min-w-0 flex-1 truncate px-1 text-sm font-medium text-slate-700 dark:text-slate-200">{activeChat?.title ?? t('chat.new')}</p>
        </header>

        {/* The conversation; the jump-to-latest button floats over its bottom edge. */}
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div ref={scrollRef} onScroll={onScroll} className="scroll-thin min-h-0 flex-1 overflow-y-auto">
            <div ref={contentRef} className={`mx-auto w-full ${CHAT_COLUMN} space-y-6 px-4 py-6`}>
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

              {messages.map((m, i) =>
                m.background ? (
                  <BackgroundReport key={m.id} message={m} />
                ) : (
                  <MessageView
                    key={m.id}
                    role={m.role}
                    content={m.content}
                    modelLabel={m.model_label}
                    toolCalls={m.tool_calls}
                    attachments={m.attachments}
                    sentAt={m.created_at}
                    questions={m.questions}
                    failed={m.failed}
                    // Only the newest question card can be answered, and not while the agent works.
                    questionsAnswered={i < messages.length - 1 || !!live}
                    onAnswer={(answer) => void send(answer)}
                    // The student's messages can be edited (not while the agent works), with < n/m > between versions.
                    {...(m.role === 'user' && !m.steer && !live && chatId && { onEdit: (text: string) => void editMessage(m.id, text) })}
                    {...(m.role === 'user' && m.version && m.versions && m.versions > 1 && { version: { current: m.version, total: m.versions, onSwitch: (v: number) => void switchVersion(m.id, v) } })}
                    // Every finished answer can start a fork; the last one can also be tried again.
                    {...(m.role === 'assistant' && !m.background && !(live && i === messages.length - 1) && chatId && { onFork: () => void forkChat(chatId, m.id) })}
                    // The last answer, once finished, can be tried again.
                    {...(i === messages.length - 1 && m.role === 'assistant' && !live && !m.questions?.length && { onRetry: (ref?: string) => void regenerate(ref), retryOptions: options ?? [] })}
                    displays={m.displays?.map((d, n) => ({ title: d.title, src: apiUrl(`/chats/${chatId}/messages/${m.id}/displays/${n}`) }))}
                    steer={m.steer ? 'applied' : undefined}
                    // A saved correction comes right after the part of the answer the agent had done.
                    steerNote={m.steer && messages[i - 1]?.tool_calls?.length ? steerNote(messages[i - 1].tool_calls) : undefined}
                  />
                ),
              )}

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
                // Still being written: not announced piece by piece (the status line above says when it is ready).
                <div aria-busy="true">
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
                          <MessageView role="user" content={st.content} steer="applied" steerNote={steerNote(live.toolCalls.slice(0, st.at ?? 0))} />
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
            </div>
          </div>
          {awayFromBottom && (
            <button
              type="button"
              onClick={scrollToBottom}
              aria-label={t('chat.scrollToBottom')}
              title={t('chat.scrollToBottom')}
              className="absolute bottom-3 left-1/2 flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-md transition hover:bg-slate-50 hover:text-slate-900 active:scale-[0.96] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white"
            >
              <ArrowDown size={17} aria-hidden="true" />
            </button>
          )}
        </div>

        <div className="shrink-0 px-4 pb-4 pt-2">
          {/* The agent's plan rises from the message box while it works. */}
          {plan && (
            <div className={`mx-auto mb-2 w-full ${CHAT_COLUMN}`}>
              <PlanDock title={plan.title} steps={plan.steps} leaving={plan.leaving} />
            </div>
          )}
          {chatId && <BackgroundTasks chatId={chatId} jobs={background} onFinished={onBackgroundFinished} />}
          {/* Corrections the agent has not read yet wait here, next to where they were written. */}
          {/* The message that goes out when the answer ends (queue or interrupt mode); it can still be taken back. */}
          {queued && (
            <div className={`mx-auto mb-2 flex w-full ${CHAT_COLUMN} justify-end`}>
              <div className="flex max-w-[85%] items-start gap-2 rounded-2xl rounded-br-md border border-dashed border-[var(--accent-400)] bg-[var(--accent-50)] px-4 py-2.5 text-[15px] text-slate-800 dark:bg-[var(--accent-500)]/10 dark:text-slate-100">
                <div className="min-w-0">
                  <p className="mb-0.5 text-xs font-medium text-[var(--accent-700)] dark:text-[var(--accent-300)]">{t(busyMode === 'interrupt' ? 'chat.interruptPending' : 'chat.queuedLabel')}</p>
                  <p className="whitespace-pre-wrap break-words">{queued}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setDraft(queued);
                    setQueued(null);
                  }}
                  aria-label={t('chat.queuedCancel')}
                  title={t('chat.queuedCancel')}
                  className="shrink-0 rounded-md p-1 text-slate-500 hover:bg-white hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </div>
            </div>
          )}
          {live && live.steers.some((st) => !st.applied) && (
            <div className={`mx-auto mb-2 w-full ${CHAT_COLUMN} space-y-2`}>
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
            onSteer={busySubmit}
            busyMode={busyMode}
            onBusyModeChange={changeBusyMode}
            busy={!!live}
            attachments={attachments.items}
            onAttach={attachments.add}
            onRemoveAttachment={attachments.remove}
            controls={
              <>
                <ModelPicker options={options ?? []} value={modelRef} onChange={setModelRef} disabled={!!live} />
                {showReasoning && <ReasoningPicker value={reasoning} onChange={chooseReasoning} disabled={!!live} />}
              </>
            }
            status={
              <>
                {chatId && context && <ContextRing usage={context} onCompact={compact} busy={!!live} compacting={compacting} />}
                {/* The workspace panel, next to the context meter. */}
                <button
                  type="button"
                  onClick={toggleFiles}
                  aria-label={filesDocked ? t('chat.hideFiles') : t('chat.showFiles')}
                  title={filesDocked ? t('chat.hideFiles') : t('chat.showFiles')}
                  aria-pressed={filesDocked}
                  className={`shrink-0 rounded-lg p-1.5 transition hover:bg-slate-100 dark:hover:bg-slate-800 ${
                    filesDocked ? 'lg:bg-[var(--accent-50)] lg:text-[var(--accent-700)] lg:dark:bg-[var(--accent-500)]/15 lg:dark:text-[var(--accent-200)]' : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {filesDocked ? <FolderOpen size={18} aria-hidden="true" /> : <Folder size={18} aria-hidden="true" />}
                </button>
              </>
            }
          />
        </div>
      </section>

      {/* Workspace files, docked on wide screens; drag its left edge to resize. */}
      {filesDocked && (
        <ResizableDock
          side="right"
          storageKey="studyhawk.filesPanelWidth"
          defaultWidth={320}
          minWidth={240}
          maxWidth={900}
          label={t('chat.resizeFiles')}
          className="hidden border-l border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 lg:block"
        >
          <WorkspacePanel onAttach={attachFromWorkspace} onClose={toggleFiles} refreshKey={filesVersion} />
        </ResizableDock>
      )}

      {/* Workspace files as a drawer on phones and tablets. */}
      {filesDrawer && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setFilesDrawer(false)} aria-hidden="true" />
          <aside className="absolute inset-y-0 right-0 w-[85vw] max-w-sm overscroll-contain bg-white shadow-xl dark:bg-slate-900">
            <WorkspacePanel onAttach={attachFromWorkspace} onClose={() => setFilesDrawer(false)} refreshKey={filesVersion} />
          </aside>
        </div>
      )}

      {toast && <Toast message={toast} />}

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

      {forking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40" role="alertdialog" aria-modal="true" aria-live="polite" aria-label={t('chat.forking')}>
          <div className="flex items-center gap-3 rounded-xl bg-white px-5 py-4 text-sm font-medium text-slate-700 shadow-2xl dark:bg-slate-900 dark:text-slate-200">
            <BrandLoader size={28} />
            {t('chat.forking')}
          </div>
        </div>
      )}
      {infoFor && <ChatInfoDialog chat={infoFor} onClose={() => setInfoFor(null)} />}
      {needsModel !== null && <ChooseModelDialog options={options ?? []} onPick={pickDefaultModel} onClose={() => setNeedsModel(null)} />}
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
