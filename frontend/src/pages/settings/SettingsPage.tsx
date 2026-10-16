import { useSearchParams } from 'react-router-dom';
import { AppWindow, Bell, BookMarked, Brain, CalendarClock, CreditCard, Gauge, Cpu, Globe, Library, Palette, Plug, UserRound } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';
import { Page, SectionLayout } from '../../components/layout/routes';
import AccountSection from './AccountSection';
import AppearanceSection from './AppearanceSection';
import ConnectionsSection from './ConnectionsSection';
import ModelsSection from './ModelsSection';
import NotificationsSection from './NotificationsSection';
import { MemorySection, RagsSection, SchedulesSection, SkillsSection } from './AgentSections';
import PlanSection from './PlanSection';
import UsageSection from './UsageSection';
import AppsSection from './AppsSection';
import BrowserSection from './BrowserSection';

const SECTIONS = ['account', 'appearance', 'connections', 'models', 'apps', 'notifications', 'schedules', 'memory', 'rags', 'browser', 'skills', 'usage', 'plan'] as const;
type Section = (typeof SECTIONS)[number];

const isSection = (value: string | null): value is Section => SECTIONS.includes(value as Section);

const SettingsPage = () => {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const requested = params.get('section');
  const active: Section = isSection(requested) ? requested : 'account';

  const sections = [
    { key: 'account' as const, label: t('nav.account'), icon: UserRound },
    { key: 'appearance' as const, label: t('settings.appearanceTitle'), icon: Palette },
    { key: 'connections' as const, label: t('nav.connections'), icon: Plug },
    { key: 'models' as const, label: t('settings.models'), icon: Cpu },
    { key: 'apps' as const, label: t('apps.navLabel'), icon: AppWindow },
    { key: 'notifications' as const, label: t('settings.notifications'), icon: Bell },
    { key: 'schedules' as const, label: t('schedules.title'), icon: CalendarClock },
    { key: 'memory' as const, label: t('memory.title'), icon: Brain },
    { key: 'rags' as const, label: t('rags.title'), icon: Library },
    { key: 'browser' as const, label: t('browser.title'), icon: Globe },
    { key: 'skills' as const, label: t('settings.skills'), icon: BookMarked },
    { key: 'usage' as const, label: t('usage.title'), icon: Gauge },
    { key: 'plan' as const, label: t('settings.plan'), icon: CreditCard },
  ];

  return (
    <Page title={t('nav.settings')}>
      <SectionLayout heading={t('nav.settings')} sections={sections} active={active} onSelect={(key) => setParams(key === 'account' ? {} : { section: key }, { replace: true })}>
        {active === 'account' && <AccountSection />}
        {active === 'appearance' && <AppearanceSection />}
        {active === 'connections' && <ConnectionsSection />}
        {active === 'models' && <ModelsSection />}
        {active === 'apps' && <AppsSection />}
        {active === 'notifications' && <NotificationsSection />}
        {active === 'schedules' && <SchedulesSection />}
        {active === 'memory' && <MemorySection />}
        {active === 'rags' && <RagsSection />}
        {active === 'browser' && <BrowserSection />}
        {active === 'skills' && <SkillsSection />}
        {active === 'usage' && <UsageSection />}
        {active === 'plan' && <PlanSection />}
      </SectionLayout>
    </Page>
  );
};

export default SettingsPage;
