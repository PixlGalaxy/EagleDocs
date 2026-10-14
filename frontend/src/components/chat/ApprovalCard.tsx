import { useState } from 'react';
import { Check, Loader2, ShieldAlert, X } from 'lucide-react';
import type { Approval } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import { btn } from '../ui/styles';

interface Props {
  approval: Approval;
  /** Omit to render a read-only preview (landing page). */
  onDecide?: (approve: boolean) => Promise<void>;
}

/**
 * Shown only for irreversible actions (deleting files, sending something).
 * Reading and planning never ask. For sends the card repeats the product
 * stance that the assistant should not act on the student's behalf.
 */
const ApprovalCard = ({ approval, onDecide }: Props) => {
  const { t } = useI18n();
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const decided = approval.status !== 'pending';

  const decide = async (approve: boolean) => {
    if (!onDecide) return;
    setBusy(approve ? 'approve' : 'reject');
    try {
      await onDecide(approve);
    } finally {
      setBusy(null);
    }
  };

  // Once decided it is only a record: one compact line.
  if (decided) {
    const ok = approval.status === 'approved';
    return (
      <p className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs ${ok ? 'border-emerald-200 bg-emerald-50/60 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200' : 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300'}`}>
        {ok ? <Check size={13} className="shrink-0" aria-hidden="true" /> : <X size={13} className="shrink-0" aria-hidden="true" />}
        <span className="font-medium">{ok ? t('approval.approved') : approval.status === 'rejected' ? t('approval.rejected') : t('approval.expired')}</span>
        <span className="min-w-0 truncate">{approval.summary}</span>
      </p>
    );
  }

  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50/70 p-4 dark:border-amber-500/40 dark:bg-amber-500/10">
      <div className="flex items-start gap-3">
        <ShieldAlert size={20} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-300" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-amber-950 dark:text-amber-100">{t('approval.title')}</h3>
          <p className="mt-1 text-sm text-amber-900 dark:text-amber-200">{approval.summary}</p>

          {Object.keys(approval.details).length > 0 && (
            <dl className="mt-3 space-y-1.5 rounded-lg bg-white/70 p-3 text-sm dark:bg-slate-900/50">
              {Object.entries(approval.details).map(([key, value]) => (
                <div key={key} className="grid grid-cols-[6rem_1fr] gap-2">
                  <dt className="font-medium text-slate-500 dark:text-slate-400">{key}</dt>
                  <dd className="whitespace-pre-wrap break-words text-slate-800 dark:text-slate-200">{value}</dd>
                </div>
              ))}
            </dl>
          )}

          <p className="mt-3 text-sm font-medium text-amber-900 dark:text-amber-200">
            {/* Sending is the one action the product says EagleDocs should not take for the student. */}
            {/(^|[._])send$/.test(approval.tool_name) ? t('approval.warningSend') : t('approval.warning')}
          </p>

          {decided ? (
            <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
              {approval.status === 'approved' ? t('approval.approved') : approval.status === 'rejected' ? t('approval.rejected') : t('approval.expired')}
            </p>
          ) : (
            // A preview (no onDecide) keeps full colors but takes no input.
            <div className={`mt-4 flex flex-wrap gap-2 ${onDecide ? '' : 'pointer-events-none'}`} inert={!onDecide}>
              <button type="button" onClick={() => void decide(false)} disabled={busy !== null} className={btn.secondary}>
                {busy === 'reject' ? <Loader2 size={16} className="animate-spin" /> : <X size={16} />}
                {t('approval.reject')}
              </button>
              <button type="button" onClick={() => void decide(true)} disabled={busy !== null} className={btn.warning}>
                {busy === 'approve' ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                {t('approval.approve')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ApprovalCard;
