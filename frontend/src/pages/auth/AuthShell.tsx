import { useEffect, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Eye, EyeOff } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';
import { BrandLogo } from '../../components/BrandLogo';
import { input } from '../../components/ui/styles';
import type { TranslationKey } from '../../i18n/translations';

// The S+H mark (BrandLogo.tsx), all white, twice per tile and staggered: the brand panel's pattern.
const MARK_S = 'M318.1 439.2 339.6 515.9H703.5L566.4 697.6H17.5L152.1 519.2L78.5 258H436.3L414.6 181.3H56.2L5 -0H551.5L676.6 439.2Z';
const MARK_H = 'M563.1 703.2 463.9 353.3H294.6L392.2 697.6H18.5L152.9 519.5L104.9 349.9L6 0H194.4L243.3 172H412.7L364.1 0H552.5L700.3 521.5Z';
const mark = (x: number, y: number) =>
  `<g transform="translate(${x},${y})"><path transform="scale(1,-1)" d="${MARK_S}"/><path transform="translate(386,516) scale(1,-1)" d="${MARK_H}"/></g>`;
const PATTERN = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2600 2600" fill="#fff">${mark(150, 760)}${mark(1450, 2060)}</svg>`,
)}")`;

// How far the panel's edge leans from top to bottom.
const SLANT = '11rem';

// Study tips under the panel text, three at a time, like the tips on a game's loading screen.
const TIP_COUNT = 15;
const TIPS_SHOWN = 3;
// Time on screen grows with the text: a base, plus enough to read each character, within limits.
const tipMs = (chars: number) => Math.min(20_000, Math.max(7000, 3000 + chars * 45));
const tip = (n: number) => ({ title: `auth.tip${n}Title` as TranslationKey, body: `auth.tip${n}` as TranslationKey });

const RotatingTips = () => {
  const { t } = useI18n();
  const reduce = useReducedMotion();
  const groups = TIP_COUNT / TIPS_SHOWN;
  const [group, setGroup] = useState(() => Math.floor(Math.random() * groups));
  const items = Array.from({ length: TIPS_SHOWN }, (_, i) => tip(group * TIPS_SHOWN + i + 1));
  const ms = tipMs(items.reduce((sum, item) => sum + t(item.title).length + t(item.body).length, 0));
  useEffect(() => {
    const timer = setTimeout(() => setGroup((g) => (g + 1) % groups), ms);
    return () => clearTimeout(timer);
  }, [group, groups, ms]);
  return (
    <div className="mt-10" aria-live="polite">
      <AnimatePresence mode="wait" initial={false}>
        <motion.ul key={group} className="space-y-7" exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
          {items.map((item, i) => (
            <motion.li
              key={item.body}
              className="flex gap-5"
              initial={reduce ? { opacity: 0 } : { opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.35, delay: reduce ? 0 : i * 0.12 }}
            >
              <span aria-hidden="true" className="mt-1.5 h-4 w-4 shrink-0 rounded-full bg-white ring-4 ring-white/25" />
              <div>
                <p className="text-lg font-semibold xl:text-xl">{t(item.title)}</p>
                <p className="mt-1 text-base leading-relaxed text-white/80">{t(item.body)}</p>
              </div>
            </motion.li>
          ))}
        </motion.ul>
      </AnimatePresence>
      {/* Fills up until the next three tips. */}
      <div className="mt-8 h-1 max-w-md overflow-hidden rounded-full bg-white/15" aria-hidden="true">
        <motion.div
          key={group}
          className="h-full origin-left rounded-full bg-white/70"
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: ms / 1000, ease: 'linear' }}
        />
      </div>
    </div>
  );
};

/** Two-column auth layout: brand panel on large screens, form card everywhere. */
export const AuthShell = ({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) => {
  const { t } = useI18n();
  return (
    <div className="grid min-h-[100dvh] bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100 lg:grid-cols-2 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <title>{`${title} - StudyHawk`}</title>
      {/* The right edge leans like the letters of the logo. */}
      <aside
        className="relative isolate hidden overflow-hidden bg-[var(--accent-700)] p-12 pr-48 text-white lg:col-start-1 lg:row-start-1 lg:flex lg:flex-col lg:justify-between dark:bg-[var(--accent-900)]"
        style={{ clipPath: `polygon(0 0, 100% 0, calc(100% - ${SLANT}) 100%, 0 100%)` }}
      >
        {/* A faint repeat of the mark behind the text. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 opacity-[0.07]" style={{ backgroundImage: PATTERN, backgroundSize: '132px 132px' }} />
        <Link to="/" className="flex items-center gap-3">
          {/* On the colored panel the whole logo is white. */}
          <BrandLogo mono className="h-12 w-auto text-white xl:h-14" />
        </Link>
        <div className="max-w-2xl">
          <p className="text-4xl font-semibold leading-tight tracking-tight xl:text-5xl">{t('auth.panelTitle')}</p>
          <p className="mt-5 text-lg leading-relaxed text-white/80 xl:text-xl">{t('auth.panelBody')}</p>
          <RotatingTips />
        </div>
        <p className="text-base text-white/60">{t('auth.panelFoot')}</p>
      </aside>

      <main className="flex flex-col items-center justify-center px-4 py-10 sm:px-8 lg:col-start-2 lg:row-start-1">
        <Link to="/" className="mb-8 flex items-center gap-2.5 lg:hidden">
          <BrandLogo className="h-8 w-auto" />
        </Link>
        <div className="w-full max-w-md">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">{title}</h1>
          {subtitle && <div className="mt-2 text-sm text-slate-600 dark:text-slate-400">{subtitle}</div>}
          <div className="mt-8">{children}</div>
          {footer && <div className="mt-8 text-center text-sm text-slate-600 dark:text-slate-400">{footer}</div>}
        </div>
      </main>
    </div>
  );
};

/** Password input with a show/hide toggle. */
export const PasswordInput = (props: InputHTMLAttributes<HTMLInputElement>) => {
  const { t } = useI18n();
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      {/* The server refuses longer passwords (256): stop typing there. */}
      <input maxLength={256} {...props} type={show ? 'text' : 'password'} className={`${input} py-2.5 pr-11`} />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? t('auth.hidePassword') : t('auth.showPassword')}
        aria-pressed={show}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100"
      >
        {show ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  );
};

export const authInput = `${input} py-2.5`;
export const authSubmit =
  'flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--accent-600)] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[var(--accent-700)] active:scale-[0.99] disabled:bg-slate-300 disabled:text-slate-500 dark:disabled:bg-slate-800 dark:disabled:text-slate-500';
export const authLink = 'font-medium text-[var(--accent-700)] hover:underline dark:text-[var(--accent-300)]';
