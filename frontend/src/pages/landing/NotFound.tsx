import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n/I18nContext';
import PublicNavbar from '../../components/layout/PublicNavbar';

/** The original 404: Galaxy artwork and the RaceSpace type, kept as the brand's signature page. */
const NotFound = () => {
  const { t } = useI18n();
  return (
    <div className="flex min-h-[100dvh] flex-col bg-amber-50 text-slate-950 dark:bg-slate-950 dark:text-white">
      <title>404 - EagleDocs</title>
      <PublicNavbar />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-center justify-center gap-8 px-4 py-12 md:flex-row">
        <img src="/Galaxy.webp" alt={t('notFound.art')} width={512} height={512} className="w-64 md:w-[28rem]" />
        <div className="text-center md:text-left">
          <h1 className="font-race text-[6rem] leading-none md:text-[9rem]">404</h1>
          <p className="mt-4 font-race text-2xl md:text-3xl">{t('notFound.body')}</p>
          <Link to="/" className="mt-6 inline-block font-race text-xl text-[var(--accent-700)] hover:underline dark:text-[var(--accent-300)]">
            {t('notFound.home')}
          </Link>
        </div>
      </main>
      <p className="px-4 py-3 text-right text-sm text-slate-600 dark:text-slate-400">ArtWork By PulexArt</p>
    </div>
  );
};

export default NotFound;
