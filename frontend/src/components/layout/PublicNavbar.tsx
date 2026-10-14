import { useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { useI18n } from '../../i18n/I18nContext';
import type { TranslationKey } from '../../i18n/translations';
import { DISCORD_URL, LOGO_SRC, STATUS_URL } from '../brand';

const LINKS: { to: string; key: TranslationKey }[] = [
  { to: '/', key: 'landingNav.home' },
  { to: '/about', key: 'landingNav.about' },
  { to: '/developers', key: 'landingNav.developers' },
  { to: '/github', key: 'landingNav.github' },
];

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
    isActive
      ? 'text-[var(--accent-700)] dark:text-[var(--accent-300)]'
      : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
  }`;

/** Marketing-site navigation: same pages as before the redesign, plus account actions. */
const PublicNavbar = () => {
  const { user } = useAuth();
  const { mode } = useTheme();
  const { t } = useI18n();
  const location = useLocation();
  // The mobile sheet remembers which page it was opened on, so navigating closes it.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === location.pathname;
  const setOpen = (fn: (v: boolean) => boolean) => setOpenOn(fn(open) ? location.pathname : null);

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-white/85 backdrop-blur-md dark:border-slate-800/70 dark:bg-slate-950/85">
      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6" aria-label={t('landingNav.label')}>
        <Link to="/" className="flex shrink-0 items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-500)]">
          <img src={LOGO_SRC} alt="" width={32} height={32} className="h-8 w-8" />
          <span className="text-lg font-semibold tracking-tight text-slate-900 dark:text-white" translate="no">EagleDocs</span>
        </Link>

        <div className="hidden items-center gap-1 lg:flex">
          {LINKS.map(({ to, key }) => (
            <NavLink key={to} to={to} end={to === '/'} className={linkClass}>
              {t(key)}
            </NavLink>
          ))}
          <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer" className={linkClass({ isActive: false })}>
            Discord
          </a>
        </div>

        <div className="flex items-center gap-2">
          <a
            href={STATUS_URL}
            target="_blank"
            rel="noopener noreferrer"
            title={t('landingNav.status')}
            className="hidden xl:block"
          >
            <iframe
              src={`${STATUS_URL}/badge?theme=${mode}`}
              width={250}
              height={30}
              title={t('landingNav.status')}
              className="pointer-events-none border-0"
              style={{ colorScheme: 'normal' }}
            />
          </a>

          {user ? (
            <Link to="/chat" className="hidden rounded-full bg-[var(--accent-600)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--accent-700)] active:scale-[0.98] sm:inline-flex">
              {t('landingNav.openApp')}
            </Link>
          ) : (
            <>
              <Link to="/login" className="hidden rounded-full px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800 sm:inline-flex">
                {t('landingNav.signIn')}
              </Link>
              <Link to="/register" className="hidden rounded-full bg-[var(--accent-600)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--accent-700)] active:scale-[0.98] sm:inline-flex">
                {t('landingNav.getStarted')}
              </Link>
            </>
          )}

          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="public-mobile-nav"
            aria-label={open ? t('landingNav.closeMenu') : t('landingNav.openMenu')}
            className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 lg:hidden"
          >
            {open ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </nav>

      {open && (
        <div id="public-mobile-nav" className="border-t border-slate-200 bg-white px-4 pb-5 pt-2 dark:border-slate-800 dark:bg-slate-950 lg:hidden">
          <div className="flex flex-col">
            {LINKS.map(({ to, key }) => (
              <NavLink key={to} to={to} end={to === '/'} className={(s) => `${linkClass(s)} py-3`}>
                {t(key)}
              </NavLink>
            ))}
            <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer" className={`${linkClass({ isActive: false })} py-3`}>
              Discord
            </a>
            <a href={STATUS_URL} target="_blank" rel="noopener noreferrer" className={`${linkClass({ isActive: false })} py-3`}>
              {t('landingNav.status')}
            </a>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            {user ? (
              <Link to="/chat" className="col-span-2 rounded-lg bg-[var(--accent-600)] px-4 py-2.5 text-center text-sm font-medium text-white">
                {t('landingNav.openApp')}
              </Link>
            ) : (
              <>
                <Link to="/login" className="rounded-lg border border-slate-300 px-4 py-2.5 text-center text-sm font-medium text-slate-700 dark:border-slate-700 dark:text-slate-200">
                  {t('landingNav.signIn')}
                </Link>
                <Link to="/register" className="rounded-lg bg-[var(--accent-600)] px-4 py-2.5 text-center text-sm font-medium text-white">
                  {t('landingNav.getStarted')}
                </Link>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
};

export default PublicNavbar;
