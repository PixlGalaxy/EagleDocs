import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Loader2, Megaphone, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAppConfig } from '../../context/AppConfigContext';
import { useI18n } from '../../i18n/I18nContext';
import AppNavbar from './AppNavbar';

function FullPageSpinner() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-slate-50 dark:bg-slate-950">
      <Loader2 className="animate-spin text-[var(--accent-500)] motion-reduce:animate-none" size={32} aria-label="Loading" />
    </div>
  );
}

const DISMISSED_KEY = 'studyhawk.dismissedBroadcast';

function BroadcastBanner() {
  const { broadcast } = useAppConfig();
  const { t } = useI18n();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISSED_KEY);
    } catch {
      return null;
    }
  });

  if (!broadcast || dismissed === broadcast.id) return null;

  const dismiss = () => {
    setDismissed(broadcast.id);
    try {
      localStorage.setItem(DISMISSED_KEY, broadcast.id);
    } catch {
      // Private mode: it comes back after a reload, which is fine.
    }
  };

  return (
    <div className="flex items-start gap-3 border-b border-[var(--accent-200)] bg-[var(--accent-50)] px-4 py-2.5 text-sm text-[var(--accent-900)] dark:border-[var(--accent-500)]/30 dark:bg-[var(--accent-500)]/10 dark:text-[var(--accent-100)] sm:px-6">
      <Megaphone size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1">
        <span className="font-semibold">{broadcast.title}</span> {broadcast.body}{' '}
        {broadcast.url && (
          <a href={broadcast.url} className="font-medium underline underline-offset-2">
            {t('broadcast.open')}
          </a>
        )}
      </p>
      <button type="button" onClick={dismiss} aria-label={t('common.dismiss')} className="rounded p-0.5 hover:bg-black/5 dark:hover:bg-white/10">
        <X size={16} />
      </button>
    </div>
  );
}

/** Signed-in shell: navbar on top, the page fills the rest of the viewport. */
export function ProtectedRoute() {
  const { user, isLoading } = useAuth();
  const { t } = useI18n();
  const location = useLocation();

  if (isLoading) return <FullPageSpinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <AppShell skipLabel={t('common.skip')} />;
}

/**
 * The app fills the window and each part scrolls by itself (chat, lists, panels). The page itself never
 * scrolls here: a panel or a stray element taller than the window would otherwise let the whole app slide up.
 */
function AppShell({ skipLabel }: { skipLabel: string }) {
  useEffect(() => {
    document.documentElement.classList.add('app-locked');
    return () => document.documentElement.classList.remove('app-locked');
  }, []);

  return (
    <div className="relative flex h-[100dvh] flex-col overflow-hidden bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-lg dark:focus:bg-slate-900">
        {skipLabel}
      </a>
      <AppNavbar />
      <BroadcastBanner />
      <div id="main" className="flex min-h-0 flex-1 flex-col">
        {/* Lazy pages load under the navbar instead of blanking the whole app. */}
        <Suspense fallback={null}>
          <Outlet />
        </Suspense>
      </div>
    </div>
  );
}

export function AdminRoute() {
  const { user, isLoading } = useAuth();
  if (isLoading) return <FullPageSpinner />;
  if (!user || user.role !== 'admin') return <Navigate to="/chat" replace />;
  return <Outlet />;
}

/** Login, register and friends: a signed-in visitor goes straight to the app. */
export function GuestRoute({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const location = useLocation();
  if (isLoading) return <FullPageSpinner />;
  if (user) {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from && from !== '/login' ? from : '/chat'} replace />;
  }
  return <>{children}</>;
}

/** Scrollable, padded page body for everything except the chat. */
export function Page({ title, children, wide = false }: { title: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
      <title>{`${title} - StudyHawk`}</title>
      <div className={`mx-auto w-full px-4 py-6 sm:px-6 ${wide ? 'max-w-[1400px]' : 'max-w-6xl'}`}>{children}</div>
    </div>
  );
}

/** Left section list + content, shared by Settings and the Admin Panel (Webin Cloud layout). */
export function SectionLayout<K extends string>({
  heading,
  sections,
  active,
  onSelect,
  children,
}: {
  heading: string;
  sections: { key: K; label: string; icon: React.ComponentType<{ size?: number; 'aria-hidden'?: boolean }> }[];
  active: K;
  onSelect: (key: K) => void;
  children: ReactNode;
}) {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{heading}</h1>
      <div className="flex flex-col gap-6 md:flex-row md:items-start">
        <nav className="grid shrink-0 grid-cols-2 gap-1 sm:grid-cols-3 md:sticky md:top-0 md:flex md:w-60 md:flex-col" aria-label={heading}>
          {sections.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => onSelect(key)}
              aria-current={active === key ? 'page' : undefined}
              className={`flex min-w-0 items-center gap-2.5 rounded-lg px-3.5 py-2.5 text-left text-sm font-medium transition md:w-full ${
                active === key
                  ? 'bg-[var(--accent-50)] text-[var(--accent-700)] dark:bg-[var(--accent-500)]/15 dark:text-[var(--accent-300)]'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
              }`}
            >
              <Icon size={18} aria-hidden={true} />
              <span className="truncate">{label}</span>
            </button>
          ))}
        </nav>
        <div className="min-w-0 flex-1 space-y-6">{children}</div>
      </div>
    </div>
  );
}
