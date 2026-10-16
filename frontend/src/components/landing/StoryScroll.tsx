import { useEffect, useRef, useState } from 'react';
import { motion, useMotionValueEvent, useReducedMotion, useScroll } from 'motion/react';
import type { ToolCall } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import type { TranslationKey } from '../../i18n/translations';
import MessageView from '../chat/MessageView';

const STEPS: { title: TranslationKey; body: TranslationKey }[] = [
  { title: 'home.step1Title', body: 'home.step1Body' },
  { title: 'home.step2Title', body: 'home.step2Body' },
  { title: 'home.step3Title', body: 'home.step3Body' },
  { title: 'home.step4Title', body: 'home.step4Body' },
];

function useIsDesktop() {
  const [desktop, setDesktop] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(min-width: 768px)').matches);
  useEffect(() => {
    const query = matchMedia('(min-width: 768px)');
    const onChange = () => setDesktop(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return desktop;
}

/** Tool calls the example conversation has made by a given step. */
function callsAt(step: number): ToolCall[] {
  const status = (doneAfter: number): ToolCall['status'] => (step > doneAfter ? 'done' : 'running');
  const calls: ToolCall[] = [];
  if (step >= 1) calls.push({ id: 'up', name: 'canvas_upcoming', args: { days: 7 }, status: status(1) });
  if (step >= 2) {
    calls.push({ id: 'an', name: 'canvas_announcements', args: { days: 7 }, status: status(2) });
    calls.push({ id: 'dw', name: 'degreeworks_audit', args: {}, status: status(2) });
    calls.push({ id: 'ch', name: 'chats_search', args: { query: 'work schedule' }, status: status(2) });
  }
  return calls;
}

/**
 * Pinned scroll story (desktop): the steps on the left light up one at a time
 * while the conversation on the right advances. It is a sequence, so motion
 * here carries the narrative. Mobile and reduced motion get the final state.
 */
const StoryScroll = () => {
  const { t } = useI18n();
  const reduce = useReducedMotion();
  const desktop = useIsDesktop();
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] });
  const [step, setStep] = useState(0);
  const animated = desktop && !reduce;

  // Discrete steps only: React re-renders 4 times per pass, not on every frame.
  useMotionValueEvent(scrollYProgress, 'change', (v) => {
    const next = Math.min(STEPS.length - 1, Math.floor(v * STEPS.length));
    setStep((prev) => (prev === next ? prev : next));
  });

  const shown = animated ? step : STEPS.length - 1;

  return (
    <section ref={ref} className={animated ? 'relative h-[200vh] overflow-x-clip' : 'relative overflow-x-clip'} aria-labelledby="story-title">
      <div className={`${animated ? 'sticky top-16 flex h-[calc(100dvh-4rem)] items-center' : 'py-20'}`}>
        <div className="mx-auto grid w-full max-w-7xl items-center gap-12 px-4 sm:px-6 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-20">
          <div>
            <h2 id="story-title" className="text-4xl font-semibold tracking-[-0.03em] text-slate-950 dark:text-white md:text-5xl">
              {t('home.storyTitle')}
            </h2>
            <ol className="mt-10 space-y-7">
              {STEPS.map((s, i) => {
                const active = !animated || i === shown;
                return (
                  <li key={s.title} className={`border-l-2 pl-5 transition-[opacity,border-color] duration-500 ${active ? 'border-[var(--accent-600)] opacity-100' : 'border-slate-200 opacity-35 dark:border-slate-800'}`}>
                    <h3 className="text-lg font-semibold text-slate-950 dark:text-white">{t(s.title)}</h3>
                    <p className="mt-1 max-w-[42ch] text-slate-600 dark:text-slate-300">{t(s.body)}</p>
                  </li>
                );
              })}
            </ol>
          </div>

          <div className="relative">
            <div aria-hidden="true" className="absolute -inset-10 -z-10 rounded-[3rem] bg-[radial-gradient(closest-side,var(--accent-200),transparent)] opacity-60 blur-2xl dark:bg-[radial-gradient(closest-side,var(--accent-800),transparent)]" />
            <figure className="rounded-[1.75rem] border border-slate-200 bg-white/90 p-6 shadow-[0_30px_80px_-30px_rgb(0_70_209/0.45)] backdrop-blur dark:border-slate-800 dark:bg-slate-900/90">
              <div className="min-h-[22rem] space-y-5">
                <MessageView role="user" content={t('home.demoQuestion')} />
                {shown >= 1 && (
                  <motion.div initial={animated ? { opacity: 0, y: 12 } : false} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
                    <MessageView
                      role="assistant"
                      modelLabel={t('home.demoModel')}
                      toolCalls={callsAt(shown)}
                      content={shown >= 3 ? t('home.demoAnswer') : ''}
                      streaming={shown < 3}
                    />
                  </motion.div>
                )}
              </div>
              <figcaption className="mt-5 border-t border-slate-100 pt-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">{t('home.demoCaption')}</figcaption>
            </figure>
          </div>
        </div>
      </div>
    </section>
  );
};

export default StoryScroll;
