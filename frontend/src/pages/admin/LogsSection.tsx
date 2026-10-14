import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play, RefreshCw } from 'lucide-react';
import { ApiError } from '../../api/client';
import { LOG_PAGE_SIZES, logsApi, type LogChannel, type LogEntry, type LogFilters, type LogLevel, type LogPage } from '../../api/admin';
import { useI18n } from '../../i18n/I18nContext';
import { Panel, Skeleton } from '../../components/ui/kit';
import { btn, errorBox, input } from '../../components/ui/styles';

const CHANNEL_STYLE: Record<LogChannel, string> = {
  BACKEND: 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300',
  FRONTEND: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  AUTH: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
  SYSTEM: 'bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300',
  ENTRYPOINT: 'bg-slate-200 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300',
};

const LEVEL_STYLE: Record<LogLevel, string> = {
  INFO: 'text-slate-700 dark:text-slate-200',
  WARN: 'text-amber-700 dark:text-amber-300',
  ERROR: 'text-rose-700 dark:text-rose-300',
};

const select = `${input} py-1.5`;

/** Every replica's logs, live over SSE on page 1, like WebinCloud's Logs page. */
const LogsSection = () => {
  const { t, language } = useI18n();

  const [limit, setLimit] = useState<number>(LOG_PAGE_SIZES[0]);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<LogFilters>({ node: '', channel: '', level: 'all' });
  const [paused, setPaused] = useState(false);
  const [data, setData] = useState<LogPage | null>(null);
  const [error, setError] = useState('');
  const newestId = useRef(0);

  // Only page 1 has a "newest" edge to follow; older pages would shift under the reader.
  const live = !paused && page === 1;

  // State only changes once the response arrives, so this is safe to start from an effect.
  const load = useCallback(
    () =>
      logsApi
        .list(limit, page, filters)
        .then((next) => {
          newestId.current = Math.max(newestId.current, next.entries[0]?.id ?? 0);
          setError('');
          setData(next);
        })
        .catch((err: unknown) => setError(err instanceof ApiError ? err.message : t('common.networkError'))),
    [limit, page, filters, t],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!live) return;
    const source = new EventSource(logsApi.streamUrl(newestId.current, filters));
    source.onmessage = (event) => {
      // A reconnect replays from the original position, so skip what is already shown.
      const fresh = (JSON.parse(event.data) as LogEntry[]).filter((entry) => entry.id > newestId.current);
      if (fresh.length === 0) return;
      newestId.current = fresh[fresh.length - 1]!.id;
      setData((current) => {
        if (!current) return current;
        const total = Math.min(current.total + fresh.length, current.capacity);
        return {
          ...current,
          total,
          pages: Math.max(1, Math.ceil(total / limit)),
          entries: [...fresh.reverse(), ...current.entries].slice(0, limit),
        };
      });
    };
    return () => source.close();
  }, [live, limit, filters]);

  const setFilter = (patch: Partial<LogFilters>) => {
    newestId.current = 0;
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  };

  const resume = () => {
    setPaused(false);
    if (page !== 1) setPage(1);
    else void load();
  };

  const formatTime = (iso: string) =>
    new Intl.DateTimeFormat(language, { dateStyle: 'short', timeStyle: 'medium', hour12: false }).format(new Date(iso));

  const pages = data?.pages ?? 1;
  const from = data && data.total > 0 ? (page - 1) * limit + 1 : 0;
  const to = data ? Math.min(page * limit, data.total) : 0;
  const nodes = data?.nodes ?? [];

  return (
    <Panel
      title={t('admin.logs')}
      description={t('logs.description')}
      actions={
        <>
          <span
            className={`inline-flex items-center gap-1.5 self-center rounded-full px-2.5 py-1 text-xs font-medium ${
              live
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
                : 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
            }`}
            aria-live="polite"
          >
            {live && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" aria-hidden="true" />}
            {t(live ? 'logs.live' : page !== 1 ? 'logs.history' : 'logs.paused')}
          </span>
          {live ? (
            <button type="button" onClick={() => setPaused(true)} className={btn.secondary}>
              <Pause size={16} aria-hidden="true" /> {t('logs.pause')}
            </button>
          ) : (
            <button type="button" onClick={resume} className={btn.primary}>
              <Play size={16} aria-hidden="true" /> {t('logs.resume')}
            </button>
          )}
          <button type="button" onClick={() => void load()} className={btn.secondary}>
            <RefreshCw size={16} aria-hidden="true" />
            <span className="hidden sm:inline">{t('common.refresh')}</span>
          </button>
        </>
      }
    >
      <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-center">
        <label className="sr-only" htmlFor="log-node">{t('logs.node')}</label>
        <select id="log-node" value={filters.node} onChange={(e) => setFilter({ node: e.target.value })} className={select}>
          <option value="">{t('logs.allNodes')}</option>
          {nodes.map((node) => (
            <option key={node} value={node}>{node}</option>
          ))}
        </select>
        <label className="sr-only" htmlFor="log-channel">{t('logs.channel')}</label>
        <select id="log-channel" value={filters.channel} onChange={(e) => setFilter({ channel: e.target.value as LogChannel | '' })} className={select}>
          <option value="">{t('logs.allChannels')}</option>
          {(Object.keys(CHANNEL_STYLE) as LogChannel[]).map((channel) => (
            <option key={channel} value={channel}>{channel}</option>
          ))}
        </select>
        <label className="sr-only" htmlFor="log-level">{t('admin.logLevel')}</label>
        <select id="log-level" value={filters.level} onChange={(e) => setFilter({ level: e.target.value as LogFilters['level'] })} className={select}>
          <option value="all">{t('admin.logAll')}</option>
          <option value="warn">WARN + ERROR</option>
          <option value="error">ERROR</option>
        </select>
        <label className="flex items-center justify-end gap-2 whitespace-nowrap text-sm text-slate-600 dark:text-slate-300">
          {t('logs.perPage')}
          <select
            value={limit}
            onChange={(e) => {
              setLimit(Number(e.target.value));
              setPage(1);
            }}
            className={`${select} w-24`}
          >
            {LOG_PAGE_SIZES.map((size) => (
              <option key={size} value={size}>{size}</option>
            ))}
          </select>
        </label>
      </div>

      {error && <div className={`${errorBox} mb-4`}>{error}</div>}

      <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
        {!data ? (
          <Skeleton className="h-80" />
        ) : data.entries.length === 0 ? (
          <p className="p-12 text-center text-sm text-slate-500 dark:text-slate-400">{t('admin.noLogs')}</p>
        ) : (
          <ul className="scroll-thin max-h-[65vh] divide-y divide-slate-100 overflow-auto font-mono text-xs dark:divide-slate-800">
            {data.entries.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-1.5 hover:bg-slate-50 sm:flex-nowrap dark:hover:bg-slate-800/50"
              >
                <span className="shrink-0 text-slate-400 tabular-nums sm:w-36 dark:text-slate-500" title={entry.time}>
                  {formatTime(entry.time)}
                </span>
                <span className="w-20 shrink-0 truncate text-slate-500 dark:text-slate-400" title={entry.node_id}>
                  {entry.node_id}
                </span>
                <span className={`w-24 shrink-0 rounded px-1.5 py-0.5 text-center text-[10px] font-semibold ${CHANNEL_STYLE[entry.channel]}`}>
                  {entry.channel}
                </span>
                <span className={`w-11 shrink-0 font-semibold ${LEVEL_STYLE[entry.level]}`}>{entry.level}</span>
                <span className={`min-w-0 flex-1 basis-full break-all sm:basis-auto ${LEVEL_STYLE[entry.level]}`}>{entry.message}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600 dark:text-slate-300">
        <span className="tabular-nums">{t('logs.range', { from, to, total: data?.total ?? 0 })}</span>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setPage((current) => current - 1)} disabled={page <= 1} className={`${btn.secondary} disabled:opacity-40`}>
            <ChevronLeft size={16} aria-hidden="true" /> {t('logs.newer')}
          </button>
          <span className="tabular-nums">{t('logs.page', { page, pages })}</span>
          <button type="button" onClick={() => setPage((current) => current + 1)} disabled={page >= pages} className={`${btn.secondary} disabled:opacity-40`}>
            {t('logs.older')} <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">{t('logs.retentionNote', { count: (data?.capacity ?? 0).toLocaleString(language) })}</p>
    </Panel>
  );
};

export default LogsSection;
