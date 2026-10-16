import { useEffect, useState } from 'react';
import { ExternalLink, GitPullRequest } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';
import PublicLayout from '../../components/layout/PublicLayout';
import { GITHUB_URL } from '../../components/brand';
import { BrandIcon } from '../../components/BrandLogo';

const GitHubPage = () => {
  const { t, language } = useI18n();
  const [updated, setUpdated] = useState<string | null>(null);

  useEffect(() => {
    fetch('https://api.github.com/repos/PixlGalaxy/EagleDocs')
      .then((r) => r.json())
      .then((data: { pushed_at?: string }) => {
        if (data.pushed_at) setUpdated(new Date(data.pushed_at).toLocaleDateString(language, { year: 'numeric', month: 'long', day: 'numeric' }));
      })
      .catch(() => undefined);
  }, [language]);

  return (
    <PublicLayout title={t('landingNav.github')}>
      <section className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
        <h1 className="max-w-2xl text-4xl font-semibold tracking-tight text-slate-950 dark:text-white md:text-5xl">{t('github.title')}</h1>
        <p className="mt-4 max-w-[60ch] text-lg text-slate-600 dark:text-slate-300">{t('github.body')}</p>

        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-12 flex flex-col gap-6 rounded-2xl border border-slate-200 bg-white p-8 transition hover:border-[var(--accent-300)] dark:border-slate-800 dark:bg-slate-900 dark:hover:border-[var(--accent-500)]/50 sm:flex-row sm:items-center"
        >
          <BrandIcon className="h-20 w-20" />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 text-xl font-semibold text-slate-950 dark:text-white">
              PixlGalaxy/EagleDocs
              <ExternalLink size={16} aria-hidden="true" />
            </p>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{updated ? t('github.updated', { date: updated }) : t('github.loading')}</p>
          </div>
        </a>

        <div className="mt-12 flex items-start gap-4">
          <GitPullRequest size={24} className="mt-1 shrink-0 text-[var(--accent-600)] dark:text-[var(--accent-300)]" aria-hidden="true" />
          <div>
            <h2 className="text-xl font-semibold text-slate-950 dark:text-white">{t('github.contributeTitle')}</h2>
            <p className="mt-2 max-w-[60ch] text-slate-600 dark:text-slate-300">{t('github.contributeBody')}</p>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
};

export default GitHubPage;
