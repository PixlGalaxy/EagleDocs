import { useCallback, useEffect, useState } from 'react';
import { Gauge, RefreshCw, Snail } from 'lucide-react';
import { Link } from 'react-router-dom';
import { billingApi } from '../../api/account';
import type { ComputeWindow, UsageInfo } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import { Notice, Panel, Skeleton } from '../../components/ui/kit';
import { btn } from '../../components/ui/styles';

/** Live numbers (the sandbox's CPU) refresh this often while the section is open. */
const REFRESH_MS = 30_000;

const cu = (n: number) => (n < 10 ? n.toFixed(2) : n.toFixed(1)).replace(/\.?0+$/, '') || '0';
const gb = (mb: number) => (mb < 1024 ? `${mb} MB` : `${(mb / 1024).toFixed(1)} GB`);

/** A used/limit bar; amber close to the limit, red past it. */
function Meter({ used, limit, label }: { used: number; limit: number | null; label: string }) {
  const share = limit ? Math.min(1, used / limit) : 0;
  const tone = share >= 1 ? 'bg-red-500' : share >= 0.8 ? 'bg-amber-500' : 'bg-[var(--accent-500)]';
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={limit ?? undefined}
      aria-valuenow={used}
      className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
    >
      <div className={`h-full rounded-full transition-[width] ${tone}`} style={{ width: `${limit ? Math.max(share * 100, used > 0 ? 2 : 0) : 0}%` }} />
    </div>
  );
}

const UsageSection = () => {
  const { t, language } = useI18n();
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  // When the numbers were read: "resets in" counts from here.
  const [readAt, setReadAt] = useState(0);

  const load = useCallback(
    () =>
      billingApi
        .usage()
        .then((u) => {
          setUsage(u);
          setReadAt(Date.now());
          setFailed(false);
        })
        .catch(() => setFailed(true))
        .finally(() => setLoading(false)),
    [],
  );

  const refresh = () => {
    setLoading(true);
    void load();
  };

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  if (!usage) return failed ? <Notice tone="danger">{t('usage.loadFailed')}</Notice> : <Skeleton className="h-64 rounded-xl" />;

  const { compute, models, storage, plan, history } = usage;

  const resets = (iso: string) => {
    const minutes = Math.max(1, Math.round((new Date(iso).getTime() - readAt) / 60_000));
    const rtf = new Intl.RelativeTimeFormat(language, { numeric: 'auto' });
    if (minutes < 60) return rtf.format(minutes, 'minute');
    if (minutes < 48 * 60) return rtf.format(Math.round(minutes / 60), 'hour');
    return rtf.format(Math.round(minutes / 1440), 'day');
  };

  const windowRow = (title: string, w: ComputeWindow) => (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{title}</span>
        <span className="font-mono text-sm text-slate-700 dark:text-slate-200">
          {cu(w.used)} / {w.limit === null ? '∞' : cu(w.limit)} CU
        </span>
      </div>
      <Meter used={w.used} limit={w.limit} label={title} />
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        {w.resets_at ? t('usage.resets', { when: resets(w.resets_at) }) : t('usage.startsNext')}
      </p>
    </div>
  );

  const freeMb = Math.max(0, storage.limit_mb - storage.used_mb);
  const peak = Math.max(...history.map((h) => h.compute), 0.001);
  const weekday = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(language, { weekday: 'short' });

  return (
    <>
      <Panel
        title={t('usage.computeTitle')}
        description={t('usage.computeBody')}
        actions={
          <button type="button" onClick={refresh} disabled={loading} className={btn.secondary} aria-label={t('usage.refresh')}>
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
          </button>
        }
      >
        {compute.throttled && (
          <div className="mb-4">
            <Notice tone="warning" icon={Snail}>
              {t('usage.throttled', { cpu: compute.throttle_cpu })}{' '}
              <Link to="/settings?section=plan" className="font-medium underline">
                {t('usage.upgrade')}
              </Link>
            </Notice>
          </div>
        )}
        <div className="grid gap-5 sm:grid-cols-2">
          {windowRow(t('usage.day'), compute.day)}
          {windowRow(t('usage.week'), compute.week)}
        </div>
        <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-slate-200 pt-4 sm:grid-cols-3 dark:border-slate-700">
          <div>
            <dt className="text-xs text-slate-500 dark:text-slate-400">{t('usage.machine')}</dt>
            <dd className="mt-0.5 font-mono text-sm font-medium text-slate-900 dark:text-slate-100">
              {plan.cpu} vCPU · {plan.mem_mb} MB
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500 dark:text-slate-400">{t('usage.cpuNow')}</dt>
            <dd className="mt-0.5 font-mono text-sm font-medium text-slate-900 dark:text-slate-100">
              {compute.sandbox ? `${Math.round(compute.sandbox.cpu_percent)}%` : t('usage.sandboxOff')}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500 dark:text-slate-400">{t('usage.memNow')}</dt>
            <dd className="mt-0.5 font-mono text-sm font-medium text-slate-900 dark:text-slate-100">
              {compute.sandbox ? `${Math.round(compute.sandbox.mem_mb)} / ${plan.mem_mb} MB` : '—'}
            </dd>
          </div>
        </dl>
      </Panel>

      <Panel title={t('usage.modelTitle')} description={t('usage.modelBody')}>
        <div className="mb-1.5 flex items-baseline justify-between gap-3">
          <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{t('usage.messagesToday')}</span>
          <span className="font-mono text-sm text-slate-700 dark:text-slate-200">
            {models.studyhawk_messages} / {models.daily_limit ?? '∞'}
          </span>
        </div>
        <Meter used={models.studyhawk_messages} limit={models.daily_limit} label={t('usage.messagesToday')} />
        <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3">
          {[
            { label: t('usage.allMessages'), value: models.messages.toLocaleString(language) },
            { label: t('usage.tokensIn'), value: models.tokens_in.toLocaleString(language) },
            { label: t('usage.tokensOut'), value: models.tokens_out.toLocaleString(language) },
          ].map((s) => (
            <div key={s.label}>
              <dt className="text-xs text-slate-500 dark:text-slate-400">{s.label}</dt>
              <dd className="mt-0.5 font-mono text-sm font-medium text-slate-900 dark:text-slate-100">{s.value}</dd>
            </div>
          ))}
        </dl>
      </Panel>

      <Panel title={t('usage.storageTitle')} description={t('usage.storageBody')}>
        <div className="mb-1.5 flex items-baseline justify-between gap-3">
          <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{t('usage.workspace')}</span>
          <span className="font-mono text-sm text-slate-700 dark:text-slate-200">
            {gb(storage.used_mb)} / {gb(storage.limit_mb)}
          </span>
        </div>
        <Meter used={storage.used_mb} limit={storage.limit_mb || null} label={t('usage.workspace')} />
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('usage.free', { size: gb(freeMb) })}</p>
        <div className="mt-4 mb-1.5 flex items-baseline justify-between gap-3">
          <span className="text-sm font-medium text-slate-900 dark:text-slate-100">TEMP</span>
          <span className="font-mono text-sm text-slate-700 dark:text-slate-200">
            {gb(storage.temp_used_mb)} / {gb(storage.temp_limit_mb)}
          </span>
        </div>
        <Meter used={storage.temp_used_mb} limit={storage.temp_limit_mb || null} label="TEMP" />
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('usage.tempHint')}</p>
      </Panel>

      <Panel title={t('usage.historyTitle')} description={t('usage.historyBody')}>
        <ul className="flex h-36 items-end gap-2" aria-label={t('usage.historyTitle')}>
          {history.map((h) => (
            <li
              key={h.day}
              className="flex h-full flex-1 flex-col items-center justify-end gap-1"
              title={`${h.day}: ${cu(h.compute)} CU · ${h.messages} ${t('usage.messagesShort')}`}
            >
              <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">{h.compute > 0 ? cu(h.compute) : ''}</span>
              <div
                className="w-full max-w-10 rounded-t bg-[var(--accent-500)]"
                style={{ height: `${h.compute > 0 ? Math.max(4, (h.compute / peak) * 100) : 0}%` }}
              />
              <div className="h-px w-full bg-slate-200 dark:bg-slate-700" />
              <span className="text-xs text-slate-500 capitalize dark:text-slate-400">{weekday(h.day)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
          <Gauge size={14} aria-hidden="true" />
          {t('usage.cuExplain')}
        </p>
      </Panel>
    </>
  );
};

export default UsageSection;
