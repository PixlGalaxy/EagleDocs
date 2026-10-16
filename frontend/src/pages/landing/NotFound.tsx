import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n/I18nContext';
import PublicNavbar from '../../components/layout/PublicNavbar';
import { DRAWN, ORANGE, YELLOW, type Line } from './notFoundLines';
import './not-found.css';

const lines = (set: Line[]) => set.map(([x1, y1, x2, y2], i) => <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} />);

/** The original 404: Galaxy artwork, the RaceSpace type and the animated lines behind them, kept as the brand's signature page. */
const NotFound = () => {
  const { t } = useI18n();
  return (
    <div className="relative isolate flex min-h-[100dvh] flex-col overflow-hidden bg-[#ffec99] text-slate-950 dark:bg-slate-950 dark:text-white">
      <title>404 - StudyHawk</title>
      <svg viewBox="0 0 1820 1080" preserveAspectRatio="xMidYMid slice" aria-hidden="true" className="nf-lines pointer-events-none absolute inset-0 -z-10 h-full w-full">
        <g className="nf-drawn">{lines(DRAWN)}</g>
        <g className="nf-pulse nf-yellow">{lines(YELLOW)}</g>
        <g className="nf-pulse nf-orange">{lines(ORANGE)}</g>
      </svg>
      <PublicNavbar />
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col items-center justify-center gap-8 px-4 py-12 md:flex-row">
        <img src="/Galaxy.webp" alt={t('notFound.art')} width={512} height={512} className="w-72 md:w-[34rem]" />
        <div className="text-center md:text-left">
          <h1 className="font-race text-[7rem] leading-none md:text-[11rem]">404</h1>
          <p className="mt-4 font-race text-3xl md:text-4xl">{t('notFound.body')}</p>
          <Link to="/" className="mt-6 inline-block font-race text-2xl md:text-3xl text-[var(--accent-700)] hover:underline dark:text-[var(--accent-300)]">
            {t('notFound.home')}
          </Link>
        </div>
      </main>
      <p className="px-4 py-3 text-right text-sm text-slate-600 dark:text-slate-400">ArtWork By PulexArt</p>
    </div>
  );
};

export default NotFound;
