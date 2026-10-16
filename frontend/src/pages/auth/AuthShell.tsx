import { useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';
import { BrandLogo } from '../../components/BrandLogo';
import { input } from '../../components/ui/styles';

// The S+H mark (BrandLogo.tsx), all white, twice per tile and staggered: the brand panel's pattern.
const MARK_S = 'M318.1 439.2 339.6 515.9H703.5L566.4 697.6H17.5L152.1 519.2L78.5 258H436.3L414.6 181.3H56.2L5 -0H551.5L676.6 439.2Z';
const MARK_H = 'M563.1 703.2 463.9 353.3H294.6L392.2 697.6H18.5L152.9 519.5L104.9 349.9L6 0H194.4L243.3 172H412.7L364.1 0H552.5L700.3 521.5Z';
const mark = (x: number, y: number) =>
  `<g transform="translate(${x},${y})"><path transform="scale(1,-1)" d="${MARK_S}"/><path transform="translate(386,516) scale(1,-1)" d="${MARK_H}"/></g>`;
const PATTERN = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2600 2600" fill="#fff">${mark(150, 760)}${mark(1450, 2060)}</svg>`,
)}")`;

/** Two-column auth layout: brand panel on large screens, form card everywhere. */
export const AuthShell = ({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) => {
  const { t } = useI18n();
  return (
    <div className="grid min-h-[100dvh] bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <title>{`${title} - StudyHawk`}</title>
      <aside className="relative isolate hidden overflow-hidden bg-[var(--accent-700)] p-12 text-white lg:flex lg:flex-col lg:justify-between dark:bg-[var(--accent-900)]">
        {/* A faint repeat of the mark behind the text. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 opacity-[0.07]" style={{ backgroundImage: PATTERN, backgroundSize: '132px 132px' }} />
        <Link to="/" className="flex items-center gap-3">
          {/* On the colored panel the whole logo is white. */}
          <BrandLogo mono className="h-9 w-auto text-white" />
        </Link>
        <div className="max-w-md">
          <p className="text-3xl font-semibold leading-tight tracking-tight">{t('auth.panelTitle')}</p>
          <p className="mt-4 text-base leading-relaxed text-white/80">{t('auth.panelBody')}</p>
        </div>
        <p className="text-sm text-white/60">{t('auth.panelFoot')}</p>
      </aside>

      <main className="flex flex-col items-center justify-center px-4 py-10 sm:px-8">
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
