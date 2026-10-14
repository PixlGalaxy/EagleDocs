import { useEffect, useState } from 'react';
import { BellOff, BellRing, CircleAlert, Loader2, Share, Smartphone } from 'lucide-react';
import { pushApi } from '../../api/account';
import type { PushKind } from '../../api/types';
import { useAppConfig } from '../../context/AppConfigContext';
import { useI18n } from '../../i18n/I18nContext';
import type { TranslationKey } from '../../i18n/translations';
import { currentSubscription, isIos, isStandalone, pushSupported, subscribe } from '../../push';
import { Notice, Panel, Switch } from '../../components/ui/kit';
import { btn } from '../../components/ui/styles';

const KINDS: { id: PushKind; label: TranslationKey; hint: TranslationKey }[] = [
  { id: 'mfa_required', label: 'push.kindMfa', hint: 'push.kindMfaHint' },
  { id: 'approval_required', label: 'push.kindApproval', hint: 'push.kindApprovalHint' },
  { id: 'job_done', label: 'push.kindJob', hint: 'push.kindJobHint' },
  { id: 'broadcast', label: 'push.kindBroadcast', hint: 'push.kindBroadcastHint' },
];

const KINDS_KEY = 'eagledocs.pushKinds';

function loadKinds(): PushKind[] {
  try {
    const raw = localStorage.getItem(KINDS_KEY);
    if (raw) return JSON.parse(raw) as PushKind[];
  } catch {
    // Fall through to the default.
  }
  return KINDS.map((k) => k.id);
}

const NotificationsSection = () => {
  const { t } = useI18n();
  const { vapidPublicKey } = useAppConfig();
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [kinds, setKinds] = useState<PushKind[]>(loadKinds);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [tested, setTested] = useState(false);

  const supported = pushSupported();
  const iosNeedsInstall = isIos() && !isStandalone();

  useEffect(() => {
    void currentSubscription().then(setSubscription);
  }, []);

  const persistKinds = (next: PushKind[]) => {
    setKinds(next);
    try {
      localStorage.setItem(KINDS_KEY, JSON.stringify(next));
    } catch {
      // Not critical.
    }
    if (subscription) void pushApi.subscribe(subscription.toJSON(), next);
  };

  const enable = async () => {
    if (!vapidPublicKey) return;
    setBusy(true);
    setError('');
    try {
      const sub = await subscribe(vapidPublicKey);
      await pushApi.subscribe(sub.toJSON(), kinds);
      setSubscription(sub);
    } catch (err) {
      setError(err instanceof Error && err.message === 'permission-denied' ? t('push.denied') : t('push.failed'));
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    if (!subscription) return;
    setBusy(true);
    try {
      await pushApi.unsubscribe(subscription.endpoint);
      await subscription.unsubscribe();
      setSubscription(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Panel
        title={t('push.title')}
        description={t('push.body')}
        actions={
          subscription ? (
            <button type="button" onClick={() => void disable()} disabled={busy} className={btn.secondary}>
              <BellOff size={16} aria-hidden="true" />
              {t('push.disable')}
            </button>
          ) : (
            <button type="button" onClick={() => void enable()} disabled={busy || !supported || !vapidPublicKey || iosNeedsInstall} className={btn.primary}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : <BellRing size={16} aria-hidden="true" />}
              {t('push.enable')}
            </button>
          )
        }
      >
        <div className="space-y-4">
          {!vapidPublicKey && (
            <Notice tone="neutral" icon={CircleAlert}>
              {t('push.notConfigured')}
            </Notice>
          )}
          {!supported && !iosNeedsInstall && (
            <Notice tone="warning" icon={CircleAlert}>
              {t('push.unsupported')}
            </Notice>
          )}
          {iosNeedsInstall && (
            <Notice tone="accent" icon={Smartphone}>
              <p className="font-medium">{t('push.iosTitle')}</p>
              <p className="mt-1 flex flex-wrap items-center gap-1">
                {t('push.iosStep1')} <Share size={14} aria-label="Share" /> {t('push.iosStep2')}
              </p>
            </Notice>
          )}
          {error && (
            <Notice tone="danger" icon={CircleAlert}>
              {error}
            </Notice>
          )}
          {subscription && (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-emerald-700 dark:text-emerald-300">{t('push.enabledHere')}</span>
              <button
                type="button"
                onClick={() => void pushApi.test().then(() => setTested(true))}
                className={btn.secondary}
              >
                {t('push.test')}
              </button>
              {tested && <span className="text-sm text-slate-500">{t('push.testSent')}</span>}
            </div>
          )}
        </div>
      </Panel>

      <Panel title={t('push.kindsTitle')} description={t('push.kindsBody')}>
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {KINDS.map((kind) => (
            <li key={kind.id} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
              <div>
                <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{t(kind.label)}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{t(kind.hint)}</p>
              </div>
              <Switch
                label={t(kind.label)}
                checked={kinds.includes(kind.id)}
                onChange={(on) => persistKinds(on ? [...kinds, kind.id] : kinds.filter((k) => k !== kind.id))}
              />
            </li>
          ))}
        </ul>
      </Panel>
    </>
  );
};

export default NotificationsSection;
