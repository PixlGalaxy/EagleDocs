import { useEffect, useState } from 'react';
import { Check, CreditCard, Loader2 } from 'lucide-react';
import { billingApi } from '../../api/account';
import type { PlanInfo, Tier } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import { Badge, Panel, Skeleton } from '../../components/ui/kit';
import { btn, card } from '../../components/ui/styles';
import { formatPrice } from './format';

const PlanSection = () => {
  const { t, language } = useI18n();
  const [plan, setPlan] = useState<PlanInfo | null>(null);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [redirecting, setRedirecting] = useState<string | null>(null);

  useEffect(() => {
    billingApi.plan().then((p) => {
      setPlan(p);
      if (p.billing_enabled) void billingApi.tiers().then(setTiers);
    });
  }, []);

  const go = async (target: string, request: () => Promise<{ url: string }>) => {
    setRedirecting(target);
    try {
      window.location.href = (await request()).url;
    } catch {
      setRedirecting(null);
    }
  };

  if (!plan) return <Skeleton className="h-48 rounded-xl" />;

  const { tier, usage_today } = plan;
  const specs = [
    { label: t('plan.cpu'), value: `${tier.cpu} vCPU` },
    { label: t('plan.memory'), value: `${tier.mem_mb} MB` },
    { label: t('plan.disk'), value: `${(tier.disk_mb / 1024).toFixed(1)} GB` },
    { label: t('plan.messages'), value: `${usage_today.messages} / ${tier.daily_messages}` },
    { label: t('plan.jobs'), value: String(tier.max_background_jobs) },
    { label: t('plan.schedules'), value: String(tier.max_schedules) },
  ];

  return (
    <>
      <Panel
        title={t('plan.current', { name: tier.name })}
        description={plan.current_period_end ? t('plan.renews', { date: new Date(plan.current_period_end).toLocaleDateString(language, { dateStyle: 'medium' }) }) : t('plan.body')}
        actions={
          plan.billing_enabled && plan.subscription_status ? (
            <button type="button" onClick={() => void go('portal', billingApi.portal)} disabled={redirecting !== null} className={btn.secondary}>
              {redirecting === 'portal' ? <Loader2 size={16} className="animate-spin" /> : <CreditCard size={16} aria-hidden="true" />}
              {t('plan.manage')}
            </button>
          ) : undefined
        }
      >
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {specs.map((s) => (
            <div key={s.label}>
              <dt className="text-xs text-slate-500 dark:text-slate-400">{s.label}</dt>
              <dd className="mt-0.5 font-mono text-sm font-medium text-slate-900 dark:text-slate-100">{s.value}</dd>
            </div>
          ))}
        </dl>
      </Panel>

      {plan.billing_enabled && tiers.length > 1 && (
        <Panel title={t('plan.upgradeTitle')} description={t('plan.upgradeBody')}>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {tiers.map((option) => {
              const current = option.id === tier.id;
              return (
                <div key={option.id} className={`${card} flex flex-col p-5 ${current ? 'border-[var(--accent-500)] ring-1 ring-[var(--accent-500)]' : ''}`}>
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-slate-900 dark:text-slate-100">{option.name}</h3>
                    {current && <Badge tone="accent">{t('plan.yours')}</Badge>}
                  </div>
                  <p className="mt-2 text-2xl font-semibold text-slate-900 dark:text-white">
                    {option.price_cents ? formatPrice(option, language) : t('plan.free')}
                    {option.price_cents > 0 && <span className="text-sm font-normal text-slate-500"> / {t('plan.month')}</span>}
                  </p>
                  <ul className="mt-4 flex-1 space-y-1.5 text-sm text-slate-600 dark:text-slate-300">
                    {[`${option.cpu} vCPU · ${option.mem_mb} MB`, `${(option.disk_mb / 1024).toFixed(1)} GB`, t('plan.perDay', { count: option.daily_messages })].map((line) => (
                      <li key={line} className="flex items-center gap-2">
                        <Check size={14} className="text-[var(--accent-600)]" aria-hidden="true" />
                        {line}
                      </li>
                    ))}
                  </ul>
                  {!current && option.price_cents > 0 && (
                    <button type="button" onClick={() => void go(option.id, () => billingApi.checkout(option.id))} disabled={redirecting !== null} className={`${btn.primary} mt-5`}>
                      {redirecting === option.id && <Loader2 size={16} className="animate-spin" />}
                      {t('plan.choose')}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </Panel>
      )}
    </>
  );
};

export default PlanSection;
