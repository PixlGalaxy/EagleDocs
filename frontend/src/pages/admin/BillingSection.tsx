import { useEffect, useState, type FormEvent } from 'react';
import { CircleAlert, CreditCard, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { adminApi, type BillingSettings } from '../../api/admin';
import { ApiError } from '../../api/client';
import type { Tier } from '../../api/types';
import { useConfirm } from '../../components/ui/confirm';
import { useI18n } from '../../i18n/I18nContext';
import Modal from '../../components/ui/Modal';
import Toast from '../../components/ui/Toast';
import { Badge, Field, Notice, Panel, Skeleton, Switch } from '../../components/ui/kit';
import { btn, input } from '../../components/ui/styles';
import { PasswordInput } from '../auth/AuthShell';
import { formatPrice } from '../settings/format';

const NEW_TIER: Partial<Tier> & { name: string } = {
  name: '',
  price_cents: 0,
  currency: 'usd',
  stripe_price_id: null,
  cpu: 0.5,
  mem_mb: 512,
  disk_mb: 5120,
  daily_messages: 100,
  max_background_jobs: 1,
  max_schedules: 3,
  is_default: false,
  enabled: true,
};

const BillingSection = () => {
  const { t, language } = useI18n();
  const ask = useConfirm();
  const [tiers, setTiers] = useState<Tier[] | null>(null);
  const [billing, setBilling] = useState<BillingSettings | null>(null);
  const [draft, setDraft] = useState<(Partial<Tier> & { name: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  useEffect(() => {
    void adminApi.tiers().then(setTiers).catch(() => setTiers([]));
    void adminApi.billing().then(setBilling).catch(() => undefined);
  }, []);

  const saveTier = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    setBusy(true);
    setError('');
    try {
      const saved = await adminApi.saveTier(draft);
      setTiers((prev) => [...(prev ?? []).filter((x) => x.id !== saved.id), saved].sort((a, b) => a.price_cents - b.price_cents));
      setDraft(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.networkError'));
    } finally {
      setBusy(false);
    }
  };

  const saveBilling = async () => {
    if (!billing) return;
    setBusy(true);
    try {
      setBilling(await adminApi.saveBilling(billing));
      setToast(t('common.saved'));
      setTimeout(() => setToast(''), 2500);
    } finally {
      setBusy(false);
    }
  };

  const num = (key: keyof Tier) => (e: React.ChangeEvent<HTMLInputElement>) => draft && setDraft({ ...draft, [key]: Number(e.target.value) });

  return (
    <>
      <Panel
        title={t('admin.tiersTitle')}
        description={t('admin.tiersBody')}
        actions={
          <button type="button" onClick={() => setDraft({ ...NEW_TIER })} className={btn.primary}>
            <Plus size={16} aria-hidden="true" />
            {t('admin.newTier')}
          </button>
        }
      >
        {tiers === null ? (
          <Skeleton className="h-24" />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {tiers.map((tier) => (
              <li key={tier.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 font-medium text-slate-900 dark:text-slate-100">
                    {tier.name}
                    {tier.is_default && <Badge tone="accent">{t('admin.default')}</Badge>}
                    {!tier.enabled && <Badge>{t('admin.disabled')}</Badge>}
                  </p>
                  <p className="font-mono text-xs text-slate-500">
                    {tier.cpu} vCPU · {tier.mem_mb} MB · {tier.disk_mb} MB · {t('plan.perDay', { count: tier.daily_messages })}
                  </p>
                </div>
                <span className="font-mono text-sm text-slate-700 dark:text-slate-300">{tier.price_cents ? formatPrice(tier, language) : t('plan.free')}</span>
                <button type="button" onClick={() => setDraft(tier)} className={btn.iconGhost} aria-label={t('common.edit')}>
                  <Pencil size={16} />
                </button>
                <button
                  type="button"
                  disabled={tier.is_default}
                  onClick={() => ask(() => void adminApi.deleteTier(tier.id).then(() => setTiers((prev) => prev?.filter((x) => x.id !== tier.id) ?? null)))}
                  className={`${btn.iconDanger} disabled:opacity-30`}
                  aria-label={t('common.delete')}
                >
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title={t('admin.stripeTitle')}
        description={t('admin.stripeBody')}
        actions={billing && <Switch label={t('admin.billingEnabled')} checked={billing.enabled} onChange={(on) => setBilling({ ...billing, enabled: on })} />}
      >
        {!billing ? (
          <Skeleton className="h-32" />
        ) : (
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label={t('admin.stripeSecret')} hint={billing.stripe_secret_set ? t('admin.secretSet') : 'sk_live_...'}>
              {(id, d) => <PasswordInput id={id} aria-describedby={d} autoComplete="off" value={billing.stripe_secret_key ?? ''} onChange={(e) => setBilling({ ...billing, stripe_secret_key: e.target.value })} />}
            </Field>
            <Field label={t('admin.stripeWebhook')} hint={billing.stripe_webhook_secret_set ? t('admin.secretSet') : `whsec_... · ${window.location.origin}/api/billing/webhook`}>
              {(id, d) => <PasswordInput id={id} aria-describedby={d} autoComplete="off" value={billing.stripe_webhook_secret ?? ''} onChange={(e) => setBilling({ ...billing, stripe_webhook_secret: e.target.value })} />}
            </Field>
            <Field label={t('admin.graceDays')} hint={t('admin.graceDaysHint')}>
              {(id, d) => <input id={id} aria-describedby={d} type="number" min={0} value={billing.grace_days} onChange={(e) => setBilling({ ...billing, grace_days: Number(e.target.value) })} className={`${input} font-mono`} />}
            </Field>
            <div className="sm:col-span-2">
              <button type="button" onClick={() => void saveBilling()} disabled={busy} className={btn.primary}>
                {busy ? <Loader2 size={16} className="animate-spin" /> : <CreditCard size={16} aria-hidden="true" />}
                {t('common.save')}
              </button>
            </div>
          </div>
        )}
      </Panel>

      {draft && (
        <Modal title={draft.id ? t('admin.editTier') : t('admin.newTier')} onClose={() => setDraft(null)} size="lg">
          <form onSubmit={(e) => void saveTier(e)} className="grid gap-5 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <Field label={t('admin.tierName')}>
                {(id) => <input id={id} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={input} required />}
              </Field>
            </div>
            <Field label={t('admin.priceCents')} hint={t('admin.priceCentsHint')}>
              {(id, d) => <input id={id} aria-describedby={d} type="number" min={0} value={draft.price_cents} onChange={num('price_cents')} className={`${input} font-mono`} />}
            </Field>
            <Field label={t('admin.cpu')}>
              {(id) => <input id={id} type="number" step={0.25} min={0.25} value={draft.cpu} onChange={num('cpu')} className={`${input} font-mono`} />}
            </Field>
            <Field label={t('admin.memMb')}>
              {(id) => <input id={id} type="number" step={128} value={draft.mem_mb} onChange={num('mem_mb')} className={`${input} font-mono`} />}
            </Field>
            <Field label={t('admin.diskMb')}>
              {(id) => <input id={id} type="number" step={256} value={draft.disk_mb} onChange={num('disk_mb')} className={`${input} font-mono`} />}
            </Field>
            <Field label={t('admin.dailyMessages')}>
              {(id) => <input id={id} type="number" min={0} value={draft.daily_messages} onChange={num('daily_messages')} className={`${input} font-mono`} />}
            </Field>
            <Field label={t('plan.jobs')}>
              {(id) => <input id={id} type="number" min={1} value={draft.max_background_jobs} onChange={num('max_background_jobs')} className={`${input} font-mono`} />}
            </Field>
            <Field label={t('plan.schedules')}>
              {(id) => <input id={id} type="number" min={0} value={draft.max_schedules} onChange={num('max_schedules')} className={`${input} font-mono`} />}
            </Field>
            <div className="sm:col-span-3">
              <Field label={t('admin.stripePrice')} hint={t('admin.stripePriceHint')}>
                {(id, d) => <input id={id} aria-describedby={d} value={draft.stripe_price_id ?? ''} onChange={(e) => setDraft({ ...draft, stripe_price_id: e.target.value || null })} className={`${input} font-mono`} placeholder="price_..." />}
              </Field>
            </div>
            <label className="flex items-center gap-3 text-sm text-slate-700 dark:text-slate-300">
              <Switch label={t('admin.enabled')} checked={draft.enabled ?? true} onChange={(on) => setDraft({ ...draft, enabled: on })} />
              {t('admin.enabled')}
            </label>
            <label className="flex items-center gap-3 text-sm text-slate-700 dark:text-slate-300 sm:col-span-2">
              <Switch label={t('admin.default')} checked={draft.is_default ?? false} onChange={(on) => setDraft({ ...draft, is_default: on })} />
              {t('admin.defaultHint')}
            </label>
            {error && (
              <div className="sm:col-span-3">
                <Notice tone="danger" icon={CircleAlert}>
                  {error}
                </Notice>
              </div>
            )}
            <div className="flex justify-end gap-2 sm:col-span-3">
              <button type="button" onClick={() => setDraft(null)} className={btn.secondary}>
                {t('common.cancel')}
              </button>
              <button type="submit" disabled={busy} className={btn.primary}>
                {busy && <Loader2 size={16} className="animate-spin" />}
                {t('common.save')}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {toast && <Toast message={toast} />}
    </>
  );
};

export default BillingSection;
