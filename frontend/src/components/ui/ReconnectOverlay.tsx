import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { UNREACHABLE_EVENT } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useI18n } from '../../i18n/I18nContext';
import { BrandWordmark } from '../BrandLogo';
import BrandLoader, { CYCLE_MS } from './BrandLoader';

/** How often the server is tried again while it is away. */
const RETRY_MS = 2000;
/** The signed-in app. The landing and the sign-in pages stay usable while the server is away. */
const APP_PAGES = /^\/(chat|courses|files|settings|admin)(\/|$)/;

/**
 * Covers the app while StudyHawk does not answer (restarting, down): the page
 * behind is blurred, an SH loader plays and the line under it switches between
 * the wordmark and "Reconnecting..." once per animation cycle. It checks the
 * server every couple of seconds and goes away by itself when it is back.
 * Only in the signed-in app: the landing can still be read without the server.
 */
export default function ReconnectOverlay() {
  const { t } = useI18n();
  const { user } = useAuth();
  const { pathname } = useLocation();
  const [down, setDown] = useState(false);
  const [showWord, setShowWord] = useState(true);

  useEffect(() => {
    const onDown = () => setDown(true);
    window.addEventListener(UNREACHABLE_EVENT, onDown);
    return () => window.removeEventListener(UNREACHABLE_EVENT, onDown);
  }, []);

  // Plain fetch, not the API client: a failed check must not fire the event again.
  useEffect(() => {
    if (!down) return;
    let stopped = false;
    const check = async () => {
      const ok = await fetch('/api/health', { cache: 'no-store' })
        .then((res) => res.ok)
        .catch(() => false);
      if (stopped) return;
      if (ok) setDown(false);
      else timer = window.setTimeout(() => void check(), RETRY_MS);
    };
    let timer = window.setTimeout(() => void check(), RETRY_MS);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [down]);

  // The line under the loader changes with each animation cycle, so both move together.
  useEffect(() => {
    if (!down) return;
    const timer = window.setInterval(() => setShowWord((w) => !w), CYCLE_MS);
    return () => window.clearInterval(timer);
  }, [down]);

  if (!down || !user || !APP_PAGES.test(pathname)) return null;
  return (
    <div
      role="alertdialog"
      aria-live="assertive"
      aria-label={t('common.reconnecting')}
      className="fixed inset-0 z-[110] flex flex-col items-center justify-center gap-6 bg-slate-50/60 backdrop-blur-md dark:bg-slate-950/60"
    >
      <BrandLoader size={88} />
      <div className="grid h-7 place-items-center">
        <BrandWordmark className={`col-start-1 row-start-1 h-5 w-auto transition-opacity duration-300 ${showWord ? 'opacity-100' : 'opacity-0'}`} label="" />
        <p
          className={`col-start-1 row-start-1 whitespace-nowrap font-race text-[27px] uppercase leading-none tracking-wide text-slate-950 transition-opacity duration-300 dark:text-white ${showWord ? 'opacity-0' : 'opacity-100'}`}
        >
          {t('common.reconnecting')}
        </p>
      </div>
    </div>
  );
}
