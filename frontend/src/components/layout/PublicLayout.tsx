import type { ReactNode } from 'react';
import PublicNavbar from './PublicNavbar';
import PublicFooter from './PublicFooter';
import { useI18n } from '../../i18n/I18nContext';

/** Shell for the marketing pages: one theme for the whole page, footer pinned to the bottom. */
const PublicLayout = ({ children, title }: { children: ReactNode; title: string }) => {
  const { t } = useI18n();
  return (
  <div className="flex min-h-[100dvh] flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
    <title>{title === 'StudyHawk' ? title : `${title} - StudyHawk`}</title>
    <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-lg dark:focus:bg-slate-900">
      {t('common.skip')}
    </a>
    <PublicNavbar />
    <main id="main" className="flex-1">
      {children}
    </main>
    <PublicFooter />
  </div>
  );
};

export default PublicLayout;
