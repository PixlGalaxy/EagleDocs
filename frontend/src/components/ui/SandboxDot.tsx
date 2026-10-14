import type { SandboxStatus } from '../../api/admin';
import { useI18n } from '../../i18n/I18nContext';

const COLOR: Record<SandboxStatus, string> = {
  off: 'bg-rose-500',
  idle: 'bg-amber-400',
  working: 'bg-emerald-500',
};

/** A user's sandbox at a glance: red off, orange idle, green working (pulsing). */
const SandboxDot = ({ status, className = '' }: { status: SandboxStatus; className?: string }) => {
  const { t } = useI18n();
  const label = t(`admin.sandbox_${status}`);
  return (
    <span className={`relative inline-flex size-2.5 shrink-0 ${className}`} title={label}>
      {status === 'working' && <span className={`absolute inline-flex size-full animate-ping rounded-full opacity-60 ${COLOR[status]}`} />}
      <span className={`relative inline-flex size-2.5 rounded-full ring-2 ring-white dark:ring-slate-900 ${COLOR[status]}`} />
      <span className="sr-only">{label}</span>
    </span>
  );
};

export default SandboxDot;
