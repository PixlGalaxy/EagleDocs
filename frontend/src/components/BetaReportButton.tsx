import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLocation } from 'react-router-dom';
import { CheckCircle2, CircleAlert, ImagePlus, Loader2, MessageSquareWarning, Send, TriangleAlert, X } from 'lucide-react';
import { betaReportApi, BETA_REPORT_LIMITS } from '../api/betaReport';
import { ApiError } from '../api/client';
import { useAppConfig } from '../context/AppConfigContext';
import { useI18n } from '../i18n/I18nContext';
import Modal from './ui/Modal';
import { Field, Notice } from './ui/kit';
import { btn, input } from './ui/styles';

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

/**
 * The navbar's BetaTest Bug Report button, there only while the app is in beta
 * and the admin set the channel. It opens a form for a message and one screenshot.
 */
const BetaReportButton = () => {
  const { t } = useI18n();
  const { betaReport } = useAppConfig();
  const [open, setOpen] = useState(false);
  if (!betaReport) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={t('betaReport.button')}
        className="relative flex shrink-0 items-center gap-2 rounded-full bg-amber-400 px-3 py-2 text-sm font-semibold text-amber-950 shadow-sm ring-2 ring-amber-300/60 transition hover:bg-amber-300 focus:outline-none focus-visible:ring-4 focus-visible:ring-amber-500 dark:ring-amber-500/40 sm:px-4"
      >
        {/* A soft pulse so testers notice it. */}
        <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 flex h-3 w-3">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75 motion-reduce:animate-none" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-rose-500" />
        </span>
        <MessageSquareWarning size={18} aria-hidden="true" />
        <span className="hidden whitespace-nowrap lg:inline">{t('betaReport.button')}</span>
        <span className="sr-only lg:hidden">{t('betaReport.button')}</span>
      </button>
      {open && <ReportDialog onClose={() => setOpen(false)} />}
    </>
  );
};

const ReportDialog = ({ onClose }: { onClose: () => void }) => {
  const { t } = useI18n();
  const location = useLocation();
  const fileInput = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState('');
  const [shot, setShot] = useState<{ file: File; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  // Each preview URL is released when it is replaced or the dialog closes.
  useEffect(() => () => shot && URL.revokeObjectURL(shot.url), [shot]);

  const pick = (candidate: File | null | undefined) => {
    if (!candidate) return;
    if (!IMAGE_TYPES.includes(candidate.type)) return setError(t('betaReport.invalidImage'));
    if (candidate.size > BETA_REPORT_LIMITS.screenshotBytes) return setError(t('betaReport.tooLarge'));
    setError('');
    setShot({ file: candidate, url: URL.createObjectURL(candidate) });
  };

  // Ctrl+V anywhere while the dialog is open attaches a copied screenshot; pasted text still goes in the box.
  const pickRef = useRef(pick);
  useEffect(() => {
    pickRef.current = pick;
  });
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const image = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith('image/'));
      if (!image) return;
      e.preventDefault();
      pickRef.current(image);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await betaReportApi.send({ message: message.trim(), page: location.pathname + location.search, screenshot: shot?.file ?? null });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.networkError'));
    } finally {
      setBusy(false);
    }
  };

  const length = message.trim().length;
  const ready = length >= BETA_REPORT_LIMITS.messageMin && length <= BETA_REPORT_LIMITS.message;

  return (
    <Modal title={t('betaReport.title')} onClose={onClose} dismissible={!busy}>
      {sent ? (
        <div className="space-y-4">
          <Notice tone="success" icon={CheckCircle2}>
            {t('betaReport.sent')}
          </Notice>
          <button type="button" onClick={onClose} className={btn.primary}>
            {t('common.close')}
          </button>
        </div>
      ) : (
        <form onSubmit={(e) => void submit(e)} className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-300">{t('betaReport.body')}</p>
          <Notice tone="warning" icon={TriangleAlert}>
            {t('betaReport.warning')}
          </Notice>
          <Field label={t('betaReport.message')}>
            {(id) => (
              <textarea
                id={id}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={5}
                maxLength={BETA_REPORT_LIMITS.message}
                placeholder={t('betaReport.messagePlaceholder')}
                className={`${input} resize-y`}
                required
                autoFocus
              />
            )}
          </Field>
          <div>
            <p className="mb-1.5 text-sm font-medium text-slate-700 dark:text-slate-200">{t('betaReport.screenshot')}</p>
            {shot ? (
              <div className="relative overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
                <img src={shot.url} alt="" className="max-h-56 w-full bg-slate-50 object-contain dark:bg-slate-950" />
                <button
                  type="button"
                  onClick={() => setShot(null)}
                  aria-label={t('betaReport.removeScreenshot')}
                  title={t('betaReport.removeScreenshot')}
                  className="absolute right-2 top-2 rounded-full bg-slate-900/70 p-1.5 text-white hover:bg-slate-900"
                >
                  <X size={16} aria-hidden="true" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  pick(e.dataTransfer.files[0]);
                }}
                className="flex w-full flex-col items-center gap-1.5 rounded-xl border-2 border-dashed border-slate-300 px-4 py-6 text-sm text-slate-600 transition hover:border-[var(--accent-500)] hover:text-[var(--accent-700)] dark:border-slate-700 dark:text-slate-300 dark:hover:text-[var(--accent-300)]"
              >
                <ImagePlus size={22} aria-hidden="true" />
                <span className="font-medium">{t('betaReport.addScreenshot')}</span>
                <span className="text-xs text-slate-500 dark:text-slate-400">{t('betaReport.screenshotHint')}</span>
              </button>
            )}
            <input
              ref={fileInput}
              type="file"
              accept={IMAGE_TYPES.join(',')}
              className="hidden"
              onChange={(e) => {
                pick(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>
          {error && (
            <Notice tone="danger" icon={CircleAlert}>
              {error}
            </Notice>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={onClose} disabled={busy} className={btn.secondary}>
              {t('common.cancel')}
            </button>
            <button type="submit" disabled={busy || !ready} className={btn.primary}>
              {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}
              {t('betaReport.send')}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
};

export default BetaReportButton;
