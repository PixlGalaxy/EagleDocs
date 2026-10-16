import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, HelpCircle, Wrench, XCircle, type LucideIcon } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';
import type { TranslationKey } from '../../i18n/translations';
import { getSiteStatus, type SiteStatusState } from '../../api/config';

const LOOK: Record<SiteStatusState, { icon: LucideIcon; key: TranslationKey; color: string }> = {
  operational: { icon: CheckCircle2, key: 'landingNav.statusOperational', color: 'text-emerald-600 dark:text-emerald-400' },
  degraded: { icon: AlertTriangle, key: 'landingNav.statusDegraded', color: 'text-amber-500 dark:text-amber-400' },
  downtime: { icon: XCircle, key: 'landingNav.statusDowntime', color: 'text-red-600 dark:text-red-400' },
  maintenance: { icon: Wrench, key: 'landingNav.statusMaintenance', color: 'text-sky-600 dark:text-sky-400' },
  unknown: { icon: HelpCircle, key: 'landingNav.statusUnknown', color: 'text-slate-400 dark:text-slate-500' },
};

const REFRESH_MS = 60_000;

/**
 * The public status page's overall state, drawn by us instead of Better Stack's iframe badge:
 * it sizes to its text, follows the theme and the app's language. The server reads the page
 * (Admin -> General sets it); with no page or no answer it shows "Status unknown".
 */
const StatusBadge = ({ className = '' }: { className?: string }) => {
  const { t } = useI18n();
  const [status, setStatus] = useState<{ url: string | null; state: SiteStatusState } | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      getSiteStatus()
        .then((next) => alive && setStatus(next))
        .catch(() => alive && setStatus({ url: null, state: 'unknown' }));
    void load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  if (!status) return null;
  const { icon: Icon, key, color } = LOOK[status.state] ?? LOOK.unknown;
  const look = `inline-flex items-center gap-2 whitespace-nowrap rounded-lg px-2 py-1.5 text-sm font-medium text-slate-600 dark:text-slate-300 ${className}`;
  const content = (
    <>
      <Icon size={18} className={color} aria-hidden="true" />
      {t(key)}
    </>
  );
  if (!status.url) return <span className={look}>{content}</span>;
  return (
    <a
      href={status.url}
      target="_blank"
      rel="noopener noreferrer"
      title={t('landingNav.status')}
      className={`${look} transition-colors hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white`}
    >
      {content}
    </a>
  );
};

export default StatusBadge;
