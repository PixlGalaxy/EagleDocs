import { useEffect, useState, type FormEvent } from 'react';
import { Cookie, Globe, Plus, ShieldCheck, Trash2, TriangleAlert } from 'lucide-react';
import { browserApi } from '../../api/account';
import { ApiError } from '../../api/client';
import type { BrowserInfo } from '../../api/types';
import { useConfirm } from '../../components/ui/confirm';
import { useI18n } from '../../i18n/I18nContext';
import { EmptyState, Notice, Panel, Skeleton } from '../../components/ui/kit';
import { btn, input } from '../../components/ui/styles';

/** The agent's own browser: where it may act without asking, and its saved logins. */
const BrowserSection = () => {
  const { t } = useI18n();
  const ask = useConfirm();
  const [info, setInfo] = useState<BrowserInfo | null>(null);
  const [domain, setDomain] = useState('');
  const [error, setError] = useState('');

  const load = () =>
    void browserApi
      .get()
      .then(setInfo)
      .catch(() => setInfo({ available: false, trusted: [], profiles: [] }));
  useEffect(load, []);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!domain.trim()) return;
    setError('');
    try {
      await browserApi.trust(domain.trim());
      setDomain('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.networkError'));
    }
  };

  return (
    <>
      <Panel title={t('browser.title')} description={t('browser.body')}>
        {info && !info.available && (
          <div className="mb-4">
            <Notice tone="warning" icon={TriangleAlert}>
              {t('browser.unavailable')}
            </Notice>
          </div>
        )}
        <ul className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
          <li className="flex gap-2">
            <Globe size={16} className="mt-0.5 shrink-0 text-[var(--accent-500)]" aria-hidden="true" />
            {t('browser.ruleRead')}
          </li>
          <li className="flex gap-2">
            <ShieldCheck size={16} className="mt-0.5 shrink-0 text-amber-500" aria-hidden="true" />
            {t('browser.ruleAct')}
          </li>
          <li className="flex gap-2">
            <TriangleAlert size={16} className="mt-0.5 shrink-0 text-rose-500" aria-hidden="true" />
            {t('browser.ruleCanvas')}
          </li>
        </ul>
      </Panel>

      <Panel title={t('browser.trustedTitle')} description={t('browser.trustedBody')}>
        <form onSubmit={(e) => void add(e)} className="flex gap-2">
          <label htmlFor="trusted-domain" className="sr-only">
            {t('browser.domain')}
          </label>
          <input id="trusted-domain" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="library.fgcu.edu" className={input} maxLength={200} />
          <button type="submit" className={btn.primary}>
            <Plus size={16} aria-hidden="true" />
            {t('browser.add')}
          </button>
        </form>
        {error && (
          <div className="mt-3">
            <Notice tone="danger" icon={TriangleAlert}>
              {error}
            </Notice>
          </div>
        )}
        <div className="mt-4">
          {info === null ? (
            <Skeleton className="h-16" />
          ) : info.trusted.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">{t('browser.noTrusted')}</p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
              {info.trusted.map((d) => (
                <li key={d.domain} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate font-mono text-slate-800 dark:text-slate-200">{d.domain}</span>
                  <button
                    type="button"
                    onClick={() => void browserApi.untrust(d.domain).then(load)}
                    className={btn.iconDanger}
                    aria-label={t('browser.remove', { domain: d.domain })}
                  >
                    <Trash2 size={15} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Panel>

      <Panel title={t('browser.profilesTitle')} description={t('browser.profilesBody')}>
        {info === null ? (
          <Skeleton className="h-16" />
        ) : info.profiles.length === 0 ? (
          <EmptyState icon={Cookie} title={t('browser.noProfiles')} />
        ) : (
          <ul className="space-y-2">
            {info.profiles.map((profile) => (
              <li key={profile} className="flex items-center gap-3 rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700">
                <Cookie size={16} className="shrink-0 text-slate-400" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate font-medium text-slate-800 dark:text-slate-200">{profile}</span>
                <button
                  type="button"
                  onClick={() =>
                    ask(() => void browserApi.clearProfile(profile).then(load), {
                      title: t('browser.clearTitle'),
                      body: t('browser.clearBody', { profile }),
                      confirmLabel: t('browser.clear'),
                    })
                  }
                  className={btn.secondary}
                >
                  {t('browser.clear')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
};

export default BrowserSection;
