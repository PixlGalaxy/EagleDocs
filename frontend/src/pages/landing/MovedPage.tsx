import { useEffect } from 'react';
import { ArrowRight } from 'lucide-react';
import { NEW_ORIGIN } from '../../components/brand';
import { BrandLogo } from '../../components/BrandLogo';

/** How long the old domains show the notice before moving on. */
const WAIT_MS = 4000;

// Shown before the app (and its translations) loads, so the two languages live here.
const TEXT = {
  en: { title: 'EagleDocs is now StudyHawk', body: 'Same app, new name. Taking you to', go: 'Go now', note: 'You will need to sign in again on the new address.' },
  es: { title: 'EagleDocs ahora es StudyHawk', body: 'La misma app, con nuevo nombre. Te llevamos a', go: 'Ir ahora', note: 'Tendrás que iniciar sesión otra vez en la nueva dirección.' },
};

/** The old domains (eagledocs.org / .ai) still answer: they show this and move on to studyhawk.app. */
const MovedPage = () => {
  const text = navigator.language?.toLowerCase().startsWith('es') ? TEXT.es : TEXT.en;
  // Same page on the new domain.
  const target = NEW_ORIGIN + location.pathname + location.search + location.hash;

  useEffect(() => {
    document.title = text.title;
    document.documentElement.classList.toggle('dark', matchMedia('(prefers-color-scheme: dark)').matches);
    const timer = setTimeout(() => location.replace(target), WAIT_MS);
    return () => clearTimeout(timer);
  }, [target, text.title]);

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-slate-50 px-4 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="w-full max-w-md text-center">
        <BrandLogo className="mx-auto h-10 w-auto" />
        <h1 className="mt-10 text-2xl font-semibold tracking-tight">{text.title}</h1>
        <p className="mt-3 text-slate-600 dark:text-slate-300">
          {text.body} <span className="font-medium text-slate-900 dark:text-white">studyhawk.app</span>…
        </p>
        <a
          href={target}
          className="mt-8 inline-flex items-center gap-2 rounded-xl bg-[var(--accent-600)] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[var(--accent-700)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-500)] focus-visible:ring-offset-2"
        >
          {text.go}
          <ArrowRight size={16} aria-hidden="true" />
        </a>
        <p className="mt-6 text-xs text-slate-500 dark:text-slate-400">{text.note}</p>
      </div>
    </main>
  );
};

export default MovedPage;
