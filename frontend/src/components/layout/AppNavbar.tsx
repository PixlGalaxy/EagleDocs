import { useEffect, useRef, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import {
  BookOpen,
  FolderOpen,
  Gauge,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Plug,
  SlidersHorizontal,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useI18n } from '../../i18n/I18nContext';
import type { TranslationKey } from '../../i18n/translations';
import Avatar from '../ui/Avatar';
import { BrandIcon, BrandLogo } from '../BrandLogo';
import BetaReportButton from '../BetaReportButton';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-base font-medium transition sm:px-4 ${
    isActive
      ? 'bg-[var(--accent-50)] text-[var(--accent-700)] dark:bg-[var(--accent-500)]/15 dark:text-[var(--accent-300)]'
      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
  }`;

interface NavItem {
  to: string;
  labelKey: TranslationKey;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/chat', labelKey: 'nav.chat', icon: MessageSquare },
  { to: '/courses', labelKey: 'nav.courses', icon: BookOpen },
  { to: '/files', labelKey: 'nav.files', icon: FolderOpen },
];

const ACCOUNT_MENU: (NavItem & { color: string })[] = [
  { to: '/settings?section=account', labelKey: 'nav.account', icon: UserRound, color: 'text-sky-500' },
  { to: '/settings?section=connections', labelKey: 'nav.connections', icon: Plug, color: 'text-emerald-500' },
  { to: '/settings?section=usage', labelKey: 'usage.title', icon: Gauge, color: 'text-violet-500' },
  { to: '/settings?section=appearance', labelKey: 'nav.settings', icon: SlidersHorizontal, color: 'text-amber-500' },
];

/** Signed-in navigation, modelled on Webin Cloud's navbar. */
const AppNavbar = () => {
  const { user, logout } = useAuth();
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  if (!user) return null;

  return (
    <nav className="shrink-0 border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" aria-label={t('nav.label')}>
      <div className="flex h-16 w-full items-center justify-between gap-2 px-3 sm:h-20 sm:gap-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <Link
            to="/chat"
            className="flex shrink-0 items-center gap-2.5 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-500)]"
          >
            <BrandIcon label="StudyHawk" className="h-9 w-9 sm:h-10 sm:w-10 md:hidden" />
            <BrandLogo className="hidden h-8 w-auto md:block" />
          </Link>
          {/* Only while the app is in beta. */}
          <BetaReportButton />
        </div>

        <div className="flex min-w-0 items-center gap-0.5 sm:gap-1">
          {NAV_ITEMS.map(({ to, labelKey, icon: Icon }) => (
            <NavLink key={to} to={to} className={navLinkClass} title={t(labelKey)}>
              <Icon size={21} aria-hidden="true" />
              <span className="hidden sm:inline">{t(labelKey)}</span>
            </NavLink>
          ))}

          {user.role === 'admin' && (
            <NavLink to="/admin" className={navLinkClass} title={t('nav.adminPanel')}>
              <LayoutDashboard size={21} aria-hidden="true" />
              <span className="hidden lg:inline">{t('nav.adminPanel')}</span>
            </NavLink>
          )}

          <div className="relative ml-1" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label={t('nav.accountMenu')}
              className="shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-500)] focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900"
            >
              <Avatar user={user} size={40} />
            </button>

            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 z-30 mt-2 w-64 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-slate-200 bg-white py-1.5 shadow-lg dark:border-slate-700 dark:bg-slate-900"
              >
                <div className="border-b border-slate-200 px-4 pb-3 pt-2 dark:border-slate-700">
                  <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{user.display_name || user.username}</p>
                  <p className="truncate text-xs text-slate-500 dark:text-slate-400">{user.email}</p>
                </div>
                <div className="py-1.5">
                  {ACCOUNT_MENU.map(({ to, labelKey, icon: Icon, color }) => (
                    <Link
                      key={to}
                      to={to}
                      role="menuitem"
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      <Icon size={18} className={color} aria-hidden="true" />
                      {t(labelKey)}
                    </Link>
                  ))}
                </div>
                <span className="block h-px bg-slate-200 dark:bg-slate-700" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    void logout();
                  }}
                  className="mt-1.5 flex w-full items-center gap-3 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-rose-50 hover:text-rose-700 dark:text-slate-200 dark:hover:bg-rose-500/15 dark:hover:text-rose-300"
                >
                  <LogOut size={18} className="text-rose-500" aria-hidden="true" />
                  {t('nav.logout')}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
};

export default AppNavbar;
