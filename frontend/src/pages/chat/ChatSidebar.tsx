import { useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Loader2, MessageSquarePlus, Pencil, Search, Trash2, X } from 'lucide-react';
import type { Chat } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import { Skeleton } from '../../components/ui/kit';
import TasksPanel from './TasksPanel';

interface Props {
  chats: Chat[];
  loading: boolean;
  activeId: string | undefined;
  onNew: () => void;
  onRename: (chat: Chat) => void;
  onDelete: (chat: Chat) => void;
  onClose?: () => void;
}

function bucket(iso: string): 'today' | 'week' | 'older' {
  const age = Date.now() - new Date(iso).getTime();
  if (age < 24 * 3600 * 1000) return 'today';
  if (age < 7 * 24 * 3600 * 1000) return 'week';
  return 'older';
}

const ChatSidebar = ({ chats, loading, activeId, onNew, onRename, onDelete, onClose }: Props) => {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const helpersLabel = (count: number) => (count === 1 ? t('chat.helperOne') : t('chat.helpersCount', { count }));
  /** Chats whose helpers list is open. */
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const grouped = useMemo(() => {
    const filtered = chats.filter((chat) => chat.title.toLowerCase().includes(query.trim().toLowerCase()));
    return (['today', 'week', 'older'] as const).map((key) => ({ key, items: filtered.filter((chat) => bucket(chat.updated_at) === key) })).filter((group) => group.items.length);
  }, [chats, query]);

  const groupLabel = { today: t('chat.groupToday'), week: t('chat.groupWeek'), older: t('chat.groupOlder') };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 p-3">
        <button
          type="button"
          onClick={onNew}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[var(--accent-600)] px-3 py-2.5 text-sm font-medium text-white transition hover:bg-[var(--accent-700)] active:scale-[0.98]"
        >
          <MessageSquarePlus size={17} aria-hidden="true" />
          {t('chat.new')}
        </button>
        {onClose && (
          <button type="button" onClick={onClose} aria-label={t('common.close')} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 md:hidden">
            <X size={20} />
          </button>
        )}
      </div>

      <div className="px-3 pb-2">
        <label className="relative block">
          <span className="sr-only">{t('chat.search')}</span>
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('chat.search')}
            className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm text-slate-900 placeholder-slate-500 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[var(--accent-500)] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-400"
          />
        </label>
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {loading ? (
          <div className="space-y-2 px-1 pt-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-8" />
            ))}
          </div>
        ) : grouped.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-slate-500 dark:text-slate-400">{query ? t('chat.noMatches') : t('chat.noChats')}</p>
        ) : (
          grouped.map((group) => (
            <div key={group.key} className="mt-3 first:mt-1">
              <p className="px-3 pb-1 text-xs font-medium text-slate-500 dark:text-slate-400">{groupLabel[group.key]}</p>
              <ul>
                {group.items.map((chat) => {
                  const working = Boolean(chat.working || chat.active_job_id);
                  const helpers = chat.helpers ?? [];
                  const open = expanded.has(chat.id);
                  // The dot is for answers waiting to be read; the chat being looked at is read already.
                  const unread = !working && chat.unread && chat.id !== activeId;
                  return (
                    <li key={chat.id} className="group">
                      {/* One line, nothing on top of anything: the name, the helpers badge, the unread dot, and the actions on hover. */}
                      <div
                        className={`flex items-center rounded-lg transition ${
                          chat.id === activeId
                            ? 'bg-[var(--accent-50)] font-medium text-[var(--accent-800)] dark:bg-[var(--accent-500)]/15 dark:text-[var(--accent-200)]'
                            : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                        }`}
                      >
                        <NavLink to={`/chat/${chat.id}`} onClick={onClose} className="flex min-w-0 flex-1 items-center gap-2 py-2 pl-3 pr-2 text-sm">
                          {/* Working: a spinner before the name (it takes the unread dot's place until the answer is in). */}
                          {working && <Loader2 size={14} className="shrink-0 animate-spin text-[var(--accent-500)] motion-reduce:animate-none" aria-label={t('chat.working')} />}
                          <span className={`truncate ${unread ? 'font-medium text-slate-900 dark:text-white' : ''}`}>{chat.title}</span>
                          {unread && <span className="sr-only">{t('chat.unread')}</span>}
                        </NavLink>
                        {helpers.length > 0 && (
                          <button
                            type="button"
                            onClick={() => toggle(chat.id)}
                            aria-expanded={open}
                            className="mr-1.5 shrink-0 whitespace-nowrap rounded-full bg-[var(--accent-50)] px-2 py-0.5 text-[11px] font-medium text-[var(--accent-700)] transition hover:bg-[var(--accent-100)] dark:bg-[var(--accent-500)]/15 dark:text-[var(--accent-200)]"
                          >
                            {helpersLabel(helpers.length)}
                          </button>
                        )}
                        {/* Answered while away; the actions take its place on hover. */}
                        {unread && (
                          <span className="mr-3 h-2 w-2 shrink-0 rounded-full bg-emerald-500 group-focus-within:hidden group-hover:hidden [@media(hover:none)]:hidden" aria-hidden="true" />
                        )}
                        {/* Shown on hover; always on touch screens, which have no hover to reveal them. */}
                        <div className="hidden shrink-0 gap-0.5 pr-1.5 group-focus-within:flex group-hover:flex [@media(hover:none)]:flex">
                          <button
                            type="button"
                            onClick={() => onRename(chat)}
                            aria-label={t('chat.rename')}
                            className="rounded-md p-1.5 text-slate-500 hover:bg-white hover:text-slate-900 dark:hover:bg-slate-700 dark:hover:text-white"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDelete(chat)}
                            aria-label={t('chat.delete')}
                            className="rounded-md p-1.5 text-slate-500 hover:bg-white hover:text-rose-600 dark:hover:bg-slate-700 dark:hover:text-rose-400"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                      {open && helpers.length > 0 && (
                        <ul className="mb-1 ml-5 border-l border-slate-200 py-0.5 pl-2 dark:border-slate-700" aria-label={helpersLabel(helpers.length)}>
                          {helpers.map((h, i) => (
                            <li key={i}>
                              <NavLink
                                to={`/chat/${chat.id}`}
                                onClick={onClose}
                                title={h.goal}
                                className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                              >
                                {h.running ? (
                                  <Loader2 size={11} className="shrink-0 animate-spin text-[var(--accent-500)] motion-reduce:animate-none" aria-label={t('chat.working')} />
                                ) : (
                                  <span aria-hidden="true">-&gt;</span>
                                )}
                                <span className="truncate">{h.goal}</span>
                              </NavLink>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </div>
      <TasksPanel onNavigate={onClose} />
    </div>
  );
};

export default ChatSidebar;
