// WARNING - WARNING - WARNING - WARNING - WARNING - WARNING
// DO NOT MODIFY THIS SECTION IF YOU ARE SUBMITTING A PULL REQUEST. CONTRIBUTORS WILL BE AUTOMATICALLY ADDED FROM GITHUB.
// Modifying this file directly is discouraged as changes will be overwritten by codeowner aka: PixlGalaxy.

import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';
import PublicLayout from '../../components/layout/PublicLayout';
import { Skeleton } from '../../components/ui/kit';

interface GitHubUser {
  login: string;
  avatar_url: string;
  html_url: string;
  bio?: string | null;
  name?: string | null;
}

const FOUNDER = 'PixlGalaxy';
const REPO = 'PixlGalaxy/EagleDocsFE';

const DevelopersPage = () => {
  const { t } = useI18n();
  const [founder, setFounder] = useState<GitHubUser | null>(null);
  const [contributors, setContributors] = useState<GitHubUser[] | null>(null);

  useEffect(() => {
    fetch(`https://api.github.com/users/${FOUNDER}`)
      .then((r) => r.json())
      .then(setFounder)
      .catch(() => undefined);
    fetch(`https://api.github.com/repos/${REPO}/contributors`)
      .then((r) => r.json())
      .then((data: GitHubUser[]) => setContributors(Array.isArray(data) ? data.filter((c) => c.login !== 'dependabot[bot]') : []))
      .catch(() => setContributors([]));
  }, []);

  return (
    <PublicLayout title={t('landingNav.developers')}>
      <section className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
        <h1 className="text-4xl font-semibold tracking-tight text-slate-950 dark:text-white md:text-5xl">{t('developers.title')}</h1>
        <p className="mt-4 max-w-[55ch] text-lg text-slate-600 dark:text-slate-300">{t('developers.body')}</p>

        <div className="mt-12 grid gap-12 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="flex flex-col items-start">
            {founder ? (
              <img src={founder.avatar_url} alt={FOUNDER} width={128} height={128} className="h-32 w-32 rounded-full" />
            ) : (
              <Skeleton className="h-32 w-32 rounded-full" />
            )}
            <p className="mt-5 text-sm font-medium text-amber-600 dark:text-amber-400">{t('developers.founder')}</p>
            <h2 className="mt-1 text-2xl font-semibold text-slate-950 dark:text-white">{FOUNDER}</h2>
            {founder?.bio && <p className="mt-2 max-w-[40ch] text-slate-600 dark:text-slate-300">{founder.bio}</p>}
            <a href={`https://github.com/${FOUNDER}`} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex items-center gap-1.5 font-medium text-[var(--accent-700)] hover:underline dark:text-[var(--accent-300)]">
              {t('developers.profile')}
              <ExternalLink size={14} aria-hidden="true" />
            </a>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-slate-950 dark:text-white">{t('developers.contributors')}</h2>
            {contributors === null ? (
              <div className="mt-6 space-y-4">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-12" />
                ))}
              </div>
            ) : contributors.length === 0 ? (
              <p className="mt-6 text-slate-500 dark:text-slate-400">{t('developers.none')}</p>
            ) : (
              <ul className="mt-6 grid gap-4 sm:grid-cols-2">
                {contributors.map((c) => (
                  <li key={c.login}>
                    <a href={c.html_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 rounded-xl p-2 transition hover:bg-white dark:hover:bg-slate-900">
                      <img src={c.avatar_url} alt="" width={40} height={40} className="h-10 w-10 rounded-full" loading="lazy" />
                      <span className="font-medium text-slate-900 dark:text-slate-100">{c.name || c.login}</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>
    </PublicLayout>
  );
};

export default DevelopersPage;
