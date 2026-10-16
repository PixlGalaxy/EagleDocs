import { motion, useReducedMotion } from 'motion/react';
import { BellRing, Clock, Cpu, HardDrive, MemoryStick, ShieldCheck, Users } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';
import type { TranslationKey } from '../../i18n/translations';
import PublicLayout from '../../components/layout/PublicLayout';
import LogoMarquee from '../../components/landing/LogoMarquee';
import PoweredBy from '../../components/landing/PoweredBy';
import { BrandIcon } from '../../components/BrandLogo';

// Free-plan workspace defaults (plans/00-decisiones.md). Paid plans raise them.
const SPECS: { icon: typeof Cpu; label: TranslationKey; value: TranslationKey; note: TranslationKey }[] = [
  { icon: Cpu, label: 'about.specCpu', value: 'about.specCpuValue', note: 'about.specCpuNote' },
  { icon: MemoryStick, label: 'about.specMem', value: 'about.specMemValue', note: 'about.specMemNote' },
  { icon: HardDrive, label: 'about.specDisk', value: 'about.specDiskValue', note: 'about.specDiskNote' },
  { icon: Clock, label: 'about.specIdle', value: 'about.specIdleValue', note: 'about.specIdleNote' },
];

const ease = [0.16, 1, 0.3, 1] as const;

const AboutPage = () => {
  const { t } = useI18n();
  const reduce = useReducedMotion();
  const enter = (delay = 0) => ({
    initial: reduce ? false : { opacity: 0, y: 28 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, amount: 0.3 },
    transition: { duration: 0.8, delay, ease },
  });

  return (
    <PublicLayout title={t('landingNav.about')}>
      <section className="mx-auto grid max-w-7xl items-center gap-12 px-4 pb-16 pt-16 sm:px-6 md:pt-24 lg:grid-cols-[minmax(0,1fr)_auto]">
        <motion.div {...enter()} className="max-w-3xl">
          <h1 className="text-5xl font-semibold tracking-[-0.045em] text-slate-950 md:text-7xl dark:text-white">{t('about.title')}</h1>
          <p className="mt-6 max-w-[56ch] text-xl leading-relaxed text-slate-600 dark:text-slate-300">{t('about.intro')}</p>
        </motion.div>
        <BrandIcon className="hidden h-56 w-56 lg:block" />
      </section>

      {/* Models */}
      <section className="border-y border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/40">
        <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6">
          <motion.div {...enter()}>
            <h2 className="text-4xl font-semibold tracking-[-0.03em] text-slate-950 md:text-5xl dark:text-white">{t('about.modelsTitle')}</h2>
            <p className="mt-5 max-w-[60ch] text-lg leading-relaxed text-slate-600 dark:text-slate-300">{t('about.modelsBody1')}</p>
            <p className="mt-4 max-w-[60ch] text-lg leading-relaxed text-slate-600 dark:text-slate-300">{t('about.modelsBody2')}</p>
          </motion.div>
        </div>
        <div className="pb-20">
          <LogoMarquee label={t('home.worksWith')} />
        </div>
      </section>

      {/* Workspace (sandbox) */}
      <section id="workspace" className="mx-auto max-w-7xl scroll-mt-20 px-4 py-24 sm:px-6 md:py-32">
        <motion.div {...enter()} className="max-w-3xl">
          <h2 className="text-4xl font-semibold tracking-[-0.03em] text-slate-950 md:text-6xl dark:text-white">{t('about.workspaceTitle')}</h2>
          <p className="mt-5 max-w-[60ch] text-lg leading-relaxed text-slate-600 dark:text-slate-300">{t('about.workspaceBody')}</p>
        </motion.div>

        <dl className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {SPECS.map(({ icon: Icon, label, value, note }, i) => (
            <motion.div key={label} {...enter(i * 0.07)} className="rounded-[1.5rem] border border-slate-200 bg-white p-7 dark:border-slate-800 dark:bg-slate-900">
              <Icon size={22} className="text-[var(--accent-600)] dark:text-[var(--accent-300)]" aria-hidden="true" />
              <dt className="mt-6 text-sm text-slate-500 dark:text-slate-400">{t(label)}</dt>
              <dd className="mt-1 text-3xl font-semibold tracking-tight tabular-nums text-slate-950 dark:text-white">{t(value)}</dd>
              <dd className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{t(note)}</dd>
            </motion.div>
          ))}
        </dl>

        <div className="mt-16 grid gap-12 md:grid-cols-3">
          <motion.div {...enter()} className="flex gap-4">
            <Users size={24} className="mt-1 shrink-0 text-[var(--accent-600)] dark:text-[var(--accent-300)]" aria-hidden="true" />
            <div>
              <h3 className="text-xl font-semibold text-slate-950 dark:text-white">{t('about.sharedTitle')}</h3>
              <p className="mt-2 leading-relaxed text-slate-600 dark:text-slate-300">{t('about.sharedBody')}</p>
            </div>
          </motion.div>
          <motion.div {...enter(0.08)} className="flex gap-4">
            <BellRing size={24} className="mt-1 shrink-0 text-[var(--accent-600)] dark:text-[var(--accent-300)]" aria-hidden="true" />
            <div>
              <h3 className="text-xl font-semibold text-slate-950 dark:text-white">{t('about.backgroundTitle')}</h3>
              <p className="mt-2 leading-relaxed text-slate-600 dark:text-slate-300">{t('about.backgroundBody')}</p>
            </div>
          </motion.div>
          <motion.div {...enter(0.16)} className="flex gap-4">
            <ShieldCheck size={24} className="mt-1 shrink-0 text-[var(--accent-600)] dark:text-[var(--accent-300)]" aria-hidden="true" />
            <div>
              <h3 className="text-xl font-semibold text-slate-950 dark:text-white">{t('about.isolationTitle')}</h3>
              <p className="mt-2 leading-relaxed text-slate-600 dark:text-slate-300">{t('about.isolationBody')}</p>
            </div>
          </motion.div>
        </div>

        <div className="mt-20">
          <PoweredBy text={t('about.hardware')} />
        </div>
      </section>
    </PublicLayout>
  );
};

export default AboutPage;
