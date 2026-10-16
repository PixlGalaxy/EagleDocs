import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useI18n } from '../../i18n/I18nContext';
import { BrandWordmark } from '../BrandLogo';
import BrandLoader from './BrandLoader';

/** The splash stays at least this long, so the animation reads instead of flashing. */
const MIN_MS = 1200;
const FADE_MS = 300;

/**
 * Full-screen animated logo on every page load (landing included), until the
 * session is known and at least MIN_MS have passed. Not shown on in-app navigation.
 */
export default function BootSplash() {
  const { isLoading } = useAuth();
  const { t } = useI18n();
  const [minDone, setMinDone] = useState(false);
  const [gone, setGone] = useState(false);
  const fading = minDone && !isLoading;

  useEffect(() => {
    const timer = setTimeout(() => setMinDone(true), MIN_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!fading) return;
    const timer = setTimeout(() => setGone(true), FADE_MS);
    return () => clearTimeout(timer);
  }, [fading]);

  if (gone) return null;
  return (
    <div
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center gap-5 bg-slate-50 transition-opacity duration-300 dark:bg-slate-950 ${fading ? 'pointer-events-none opacity-0' : 'opacity-100'}`}
    >
      <BrandLoader size={88} label={t('common.loading')} />
      <BrandWordmark className="h-5 w-auto" label="" />
    </div>
  );
}
