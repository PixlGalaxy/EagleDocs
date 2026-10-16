import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion, type TargetAndTransition, type Transition } from 'motion/react';
import { ArrowRight, BookOpen, Box, GraduationCap, KeyRound, Server, Sparkles, Wand2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useI18n } from '../../i18n/I18nContext';
import type { TranslationKey } from '../../i18n/translations';
import PublicLayout from '../../components/layout/PublicLayout';
import ApprovalCard from '../../components/chat/ApprovalCard';
import LogoMarquee from '../../components/landing/LogoMarquee';
import StoryScroll from '../../components/landing/StoryScroll';
import PoweredBy from '../../components/landing/PoweredBy';
import { BrandIcon } from '../../components/BrandLogo';
import { BRAND_MARKS } from '../../components/brandMarks';

const PHRASES: TranslationKey[] = ['home.phrase1', 'home.phrase2', 'home.phrase3', 'home.phrase4', 'home.phrase5', 'home.phrase6', 'home.phrase7', 'home.phrase8'];

const ease = [0.16, 1, 0.3, 1] as const;

/** The original homepage's rotating taglines, typed out one character at a time. */
function Typewriter() {
  const { t } = useI18n();
  const reduce = useReducedMotion();
  const [phrase, setPhrase] = useState(0);
  const [chars, setChars] = useState(0);
  const text = t(PHRASES[phrase]!);

  useEffect(() => {
    if (reduce) {
      const timer = setTimeout(() => setPhrase((p) => (p + 1) % PHRASES.length), 4000);
      return () => clearTimeout(timer);
    }
    if (chars < text.length) {
      const timer = setTimeout(() => setChars((c) => c + 1), 45);
      return () => clearTimeout(timer);
    }
    const timer = setTimeout(() => {
      setChars(0);
      setPhrase((p) => (p + 1) % PHRASES.length);
    }, 2200);
    return () => clearTimeout(timer);
  }, [chars, text, reduce]);

  return (
    <p className="min-h-[1.5em] text-xl font-medium text-[var(--accent-700)] md:text-2xl dark:text-[var(--accent-300)]" aria-hidden="true">
      {reduce ? text : text.slice(0, chars)}
      {!reduce && <span className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[3px] animate-pulse bg-current" />}
    </p>
  );
}

function Reveal({ children, delay = 0, className = '' }: { children: React.ReactNode; delay?: number; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: 32 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.25 }}
      transition={{ duration: 0.8, delay, ease }}
    >
      {children}
    </motion.div>
  );
}

/**
 * Real screenshots of the app (taken from the running UI), shown in a window
 * frame that rises into place, sharpening from a soft blur, once it comes into view.
 */
function ProductShot() {
  const { t } = useI18n();
  const reduce = useReducedMotion();

  return (
    <div className="mx-auto mt-16 max-w-6xl px-4 sm:px-6 md:mt-20">
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 64, scale: 0.94, filter: 'blur(10px)' }}
        whileInView={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
        viewport={{ once: true, amount: 0.15 }}
        transition={{ duration: 1.1, delay: 0.25, ease }}
        className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_50px_120px_-40px_rgb(0_70_209/0.45)] dark:border-slate-800 dark:bg-slate-900 md:rounded-[1.75rem]"
      >
        <div className="flex h-9 items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 dark:border-slate-800 dark:bg-slate-900" aria-hidden="true">
          <span className="h-3 w-3 rounded-full bg-slate-300 dark:bg-slate-700" />
          <span className="h-3 w-3 rounded-full bg-slate-300 dark:bg-slate-700" />
          <span className="h-3 w-3 rounded-full bg-slate-300 dark:bg-slate-700" />
        </div>
        <img src="/landing/app-light.webp" alt={t('home.shotAlt')} width={1440} height={900} fetchPriority="high" className="block w-full dark:hidden" />
        <img src="/landing/app-dark.webp" alt={t('home.shotAlt')} width={1440} height={900} className="hidden w-full dark:block" />
      </motion.div>
    </div>
  );
}

/** crash: ED flies in and knocks SH away · eagle: the old EagleDocs logo holds the spot · back: SH lands again. */
type EggPhase = 'idle' | 'crash' | 'eagle' | 'back';
type EggAnim = { animate: TargetAndTransition; transition: Transition };

const CRASH_S = 1.3;
/** Where in the crash ED reaches SH (a fraction of CRASH_S). */
const HIT = 0.38;
const EGG_MS = { crash: CRASH_S * 1000, eagle: 6000, back: 800 };

/** The hero logo. Its easter egg: ten clicks and the old EagleDocs logo crashes in, sends SH flying, and stays a while. */
function HeroLogo() {
  const reduce = useReducedMotion();
  const [clicks, setClicks] = useState(0);
  const [phase, setPhase] = useState<EggPhase>('idle');

  useEffect(() => {
    if (phase === 'idle') return;
    const next: Record<Exclude<EggPhase, 'idle'>, EggPhase> = { crash: 'eagle', eagle: 'back', back: 'idle' };
    const timer = setTimeout(() => setPhase(next[phase]), EGG_MS[phase]);
    return () => clearTimeout(timer);
  }, [phase]);

  const onClick = () => {
    if (phase !== 'idle') return;
    if (clicks + 1 >= 10) {
      setClicks(0);
      setPhase('crash');
    } else setClicks(clicks + 1);
  };

  const eagleShown = phase === 'crash' || phase === 'eagle';
  const times = [0, HIT, 1];

  const sh: EggAnim = reduce
    ? { animate: { opacity: eagleShown ? 0 : 1 }, transition: { duration: 0.3 } }
    : phase === 'crash'
      ? { animate: { x: [0, 0, 560], y: [0, 0, -320], rotate: [0, 0, 720], opacity: [1, 1, 0] }, transition: { duration: CRASH_S, times, ease: 'easeOut' } }
      : phase === 'eagle'
        ? { animate: { opacity: 0 }, transition: { duration: 0 } }
        : phase === 'back'
          ? { animate: { x: [0, 0], y: [-240, 0], rotate: [-120, 0], opacity: [0, 1] }, transition: { duration: 0.7, ease: [0.34, 1.56, 0.64, 1] } }
          : { animate: { x: 0, y: 0, rotate: 0, opacity: 1 }, transition: { duration: 0.6, ease } };

  const ed: EggAnim = reduce
    ? { animate: { opacity: eagleShown ? 1 : 0 }, transition: { duration: 0.3 } }
    : phase === 'crash'
      ? {
          // In fast and tilted, squashes on the hit, settles.
          animate: { x: [-720, 0, 14, 0], rotate: [-28, 0, 8, 0], scaleX: [1, 0.82, 1.06, 1], opacity: [1, 1, 1, 1] },
          transition: { duration: CRASH_S, times: [0, HIT, 0.52, 0.75], ease: ['easeIn', 'easeOut', 'easeInOut'] },
        }
      : phase === 'eagle'
        ? { animate: { x: 0, y: [0, -5, 0], rotate: [0, -3, 0], opacity: 1 }, transition: { duration: 2, repeat: Infinity, ease: 'easeInOut' } }
        : { animate: { x: 0, y: 0, rotate: 0, scale: phase === 'back' ? 0.6 : 1, opacity: 0 }, transition: { duration: 0.3 } };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={eagleShown ? 'EagleDocs' : 'StudyHawk'}
      className="mx-auto mb-8 block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-500)]"
    >
      <span className="relative block h-24 w-24 md:h-32 md:w-32">
        <motion.span className="absolute inset-0 block" initial={false} {...sh}>
          <BrandIcon className="h-full w-full" />
        </motion.span>
        <motion.img
          src="/brand/eagledocs-legacy.webp"
          alt=""
          width={128}
          height={128}
          className="pointer-events-none absolute inset-0 h-full w-full"
          initial={{ opacity: 0 }}
          {...ed}
        />
        {/* The bump: a ring that flashes where they hit. */}
        {phase === 'crash' && !reduce && (
          <motion.span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-full border-4 border-[#22d3ee]"
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: [0.5, 0.5, 1.3, 2], opacity: [0, 0, 0.9, 0] }}
            transition={{ duration: CRASH_S, times: [0, HIT, HIT + 0.04, 0.75] }}
          />
        )}
      </span>
    </button>
  );
}

const HomePage = () => {
  const { t } = useI18n();
  const { user } = useAuth();
  const reduce = useReducedMotion();

  const ctaTo = user ? '/chat' : '/register';
  const ctaLabel = user ? t('landingNav.openApp') : t('landingNav.getStarted');

  const models = [
    { icon: Sparkles, title: t('home.modelChatgpt'), body: t('home.modelChatgptBody') },
    { icon: Server, title: t('home.modelHawk'), body: t('home.modelHawkBody') },
    { icon: KeyRound, title: t('home.modelKeys'), body: t('home.modelKeysBody') },
    { icon: Wand2, title: t('home.modelAuto'), body: t('home.modelAutoBody') },
  ];

  return (
    <PublicLayout title="StudyHawk">
      {/* Hero: a launch announcement, so the message is centered and the product follows. */}
      <section className="relative overflow-hidden pt-16 md:pt-24">
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[38rem] bg-[radial-gradient(60%_50%_at_50%_0%,var(--accent-100),transparent)] dark:bg-[radial-gradient(60%_50%_at_50%_0%,rgb(0_70_209/0.25),transparent)]" />
        <motion.div
          className="mx-auto max-w-4xl px-4 text-center sm:px-6"
          initial={reduce ? false : { opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease }}
        >
          <HeroLogo />
          <h1 className="text-5xl font-semibold leading-[1.02] tracking-[-0.045em] text-slate-950 sm:text-6xl md:text-8xl dark:text-white">{t('home.title')}</h1>
          <div className="mt-6">
            <Typewriter />
          </div>
          <p className="mx-auto mt-5 max-w-[44ch] text-lg leading-relaxed text-slate-600 md:text-xl dark:text-slate-300">{t('home.subtitle')}</p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <Link to={ctaTo} className="inline-flex items-center gap-2 rounded-full bg-[var(--accent-600)] px-6 py-3 font-medium text-white transition hover:bg-[var(--accent-700)] active:scale-[0.98]">
              {ctaLabel}
              <ArrowRight size={18} aria-hidden="true" />
            </Link>
            {!user && (
              <Link to="/login" className="inline-flex items-center rounded-full border border-slate-300 px-6 py-3 font-medium text-slate-800 transition hover:bg-white active:scale-[0.98] dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-900">
                {t('landingNav.signIn')}
              </Link>
            )}
          </div>
        </motion.div>
        <ProductShot />
      </section>

      <StoryScroll />

      {/* What it connects to: bento with exactly three cells. */}
      <section className="mx-auto max-w-7xl px-4 py-24 sm:px-6 md:py-32">
        <Reveal>
          <h2 className="max-w-3xl text-4xl font-semibold tracking-[-0.03em] text-slate-950 md:text-6xl dark:text-white">{t('home.connectTitle')}</h2>
          <p className="mt-5 max-w-[56ch] text-lg text-slate-600 dark:text-slate-300">{t('home.connectBody')}</p>
        </Reveal>
        <div className="mt-14 grid gap-4 md:grid-cols-[1.4fr_1fr] md:grid-rows-2">
          <Reveal className="md:row-span-2">
            <div className="flex h-full min-h-80 flex-col justify-between overflow-hidden rounded-[1.75rem] bg-[var(--accent-600)] p-8 text-white md:p-10 dark:bg-[var(--accent-700)]">
              <BookOpen size={32} aria-hidden="true" />
              <div className="mt-16">
                <h3 className="text-3xl font-semibold tracking-tight">{t('home.canvasTitle')}</h3>
                <p className="mt-3 max-w-[44ch] text-lg leading-relaxed text-white/85">{t('home.canvasBody')}</p>
              </div>
            </div>
          </Reveal>
          <Reveal delay={0.08}>
            <div className="flex h-full flex-col rounded-[1.75rem] border border-slate-200 bg-white p-8 dark:border-slate-800 dark:bg-slate-900">
              <GraduationCap size={28} className="text-[var(--accent-600)] dark:text-[var(--accent-300)]" aria-hidden="true" />
              <h3 className="mt-6 text-xl font-semibold text-slate-950 dark:text-white">{t('home.degreeTitle')}</h3>
              <p className="mt-2 leading-relaxed text-slate-600 dark:text-slate-300">{t('home.degreeBody')}</p>
            </div>
          </Reveal>
          <Reveal delay={0.16}>
            <div className="flex h-full flex-col rounded-[1.75rem] bg-slate-900 p-8 text-white dark:bg-slate-800">
              <Box size={28} aria-hidden="true" />
              <h3 className="mt-6 text-xl font-semibold">{t('home.workspaceTitle')}</h3>
              <p className="mt-2 leading-relaxed text-slate-300">{t('home.workspaceBody')}</p>
              <Link to="/about#workspace" className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-white underline-offset-4 hover:underline">
                {t('home.workspaceLink')}
                <ArrowRight size={14} aria-hidden="true" />
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Models: text column + stacked list */}
      <section className="border-y border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/40">
        <div className="mx-auto grid max-w-7xl gap-14 px-4 py-24 sm:px-6 md:py-32 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <Reveal>
            <h2 className="text-4xl font-semibold tracking-[-0.03em] text-slate-950 md:text-5xl dark:text-white">{t('home.modelsTitle')}</h2>
            <p className="mt-5 max-w-[46ch] text-lg text-slate-600 dark:text-slate-300">{t('home.modelsBody')}</p>
          </Reveal>
          <ul className="grid gap-x-10 gap-y-12 sm:grid-cols-2">
            {models.map(({ icon: Icon, title, body }, i) => (
              <li key={title}>
                <Reveal delay={i * 0.07}>
                  <Icon size={24} className="text-[var(--accent-600)] dark:text-[var(--accent-300)]" aria-hidden="true" />
                  <h3 className="mt-4 text-lg font-semibold text-slate-950 dark:text-white">{title}</h3>
                  <p className="mt-1.5 leading-relaxed text-slate-600 dark:text-slate-300">{body}</p>
                </Reveal>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Use it from ChatGPT or Claude (MCP app): same account, memory and workspace. */}
      <section className="mx-auto max-w-7xl px-4 pt-24 sm:px-6 md:pt-32">
        <Reveal>
          <div className="grid items-center gap-10 rounded-[2rem] border border-slate-200 bg-white p-8 md:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] md:p-14 dark:border-slate-800 dark:bg-slate-900">
            <div>
              <h2 className="text-4xl font-semibold tracking-[-0.03em] text-slate-950 md:text-5xl dark:text-white">{t('home.mcpTitle')}</h2>
              <p className="mt-5 max-w-[50ch] text-lg leading-relaxed text-slate-600 dark:text-slate-300">{t('home.mcpBody')}</p>
            </div>
            <ol className="space-y-5">
              {(['home.mcpStep1', 'home.mcpStep2', 'home.mcpStep3'] as const).map((key, i) => (
                <li key={key} className="flex items-start gap-4">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--accent-50)] text-sm font-semibold text-[var(--accent-700)] dark:bg-[var(--accent-500)]/15 dark:text-[var(--accent-200)]">
                    {i + 1}
                  </span>
                  <p className="pt-1 text-slate-700 dark:text-slate-200">{t(key)}</p>
                </li>
              ))}
              <li className="flex items-center gap-5 pl-12 pt-2 text-slate-400 dark:text-slate-500" aria-hidden="true">
                {(['openai', 'claude'] as const).map((k) => (
                  <svg key={k} viewBox={BRAND_MARKS[k]!.viewBox} width={28} height={28} fill="currentColor" fillRule="evenodd">
                    {BRAND_MARKS[k]!.paths.map((d) => (
                      <path key={d.slice(0, 24)} d={d} />
                    ))}
                  </svg>
                ))}
              </li>
            </ol>
          </div>
        </Reveal>
      </section>

      {/* Approval: centered statement with the real approval card */}
      <section className="mx-auto max-w-3xl px-4 py-24 text-center sm:px-6 md:py-32">
        <Reveal>
          <h2 className="text-4xl font-semibold tracking-[-0.03em] text-slate-950 md:text-5xl dark:text-white">{t('home.approvalTitle')}</h2>
          <p className="mx-auto mt-5 max-w-[52ch] text-lg text-slate-600 dark:text-slate-300">{t('home.approvalBody')}</p>
        </Reveal>
        <Reveal delay={0.1} className="mt-12 text-left">
          <ApprovalCard
            approval={{
              id: 'demo',
              job_id: 'demo',
              tool_name: 'files.delete',
              summary: t('home.approvalDemoSummary'),
              details: { [t('home.approvalDemoFolder')]: 'drafts/', [t('home.approvalDemoFiles')]: t('home.approvalDemoFilesValue') },
              status: 'pending',
            }}
          />
        </Reveal>
      </section>

      {/* Closing CTA */}
      <section className="mx-auto max-w-7xl px-4 pb-24 sm:px-6">
        <Reveal>
          <div className="relative overflow-hidden rounded-[2rem] bg-slate-950 px-8 py-16 text-center text-white sm:px-12 md:py-24 dark:bg-slate-900">
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(50%_80%_at_50%_100%,rgb(0_87_255/0.45),transparent)]" />
            <h2 className="relative text-4xl font-semibold tracking-[-0.03em] md:text-6xl">{t('home.ctaTitle')}</h2>
            <p className="relative mx-auto mt-4 max-w-[48ch] text-lg text-slate-300">{t('home.ctaBody')}</p>
            <Link to={ctaTo} className="relative mt-9 inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 font-medium text-slate-900 transition hover:bg-slate-100 active:scale-[0.98]">
              {ctaLabel}
              <ArrowRight size={18} aria-hidden="true" />
            </Link>
          </div>
        </Reveal>
      </section>

      {/* Compatibility and hardware, at the bottom: models first, then the server credit apart from them. */}
      <section className="border-t border-slate-200 pb-16 pt-16 dark:border-slate-800" aria-labelledby="works-with">
        <p id="works-with" className="mb-8 text-center text-sm font-medium text-slate-500 dark:text-slate-400">
          {t('home.worksWith')}
        </p>
        <LogoMarquee label={t('home.worksWith')} />
        <div className="mx-auto mt-14 max-w-7xl border-t border-slate-200 px-4 pt-10 sm:px-6 dark:border-slate-800">
          <PoweredBy text={t('home.poweredBy')} />
        </div>
      </section>
    </PublicLayout>
  );
};

export default HomePage;
