import { useSearchParams } from 'react-router-dom';
import { Bell, Building2, Box, CreditCard, Cpu, LayoutDashboard, Mail, ScrollText, Settings, Users } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';
import { Page, SectionLayout } from '../../components/layout/routes';
import DashboardSection from './DashboardSection';
import UsersSection from './UsersSection';
import InstitutionsSection from './InstitutionsSection';
import ModelsAdminSection from './ModelsAdminSection';
import SandboxSection from './SandboxSection';
import { EmailSection, PushAdminSection } from './MessagingSections';
import BillingSection from './BillingSection';
import { GeneralSection } from './GeneralSections';
import LogsSection from './LogsSection';

const SECTIONS = ['dashboard', 'users', 'institutions', 'models', 'sandbox', 'email', 'push', 'billing', 'settings', 'logs'] as const;
type Section = (typeof SECTIONS)[number];
const isSection = (value: string | null): value is Section => SECTIONS.includes(value as Section);

const AdminPage = () => {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const requested = params.get('section');
  const active: Section = isSection(requested) ? requested : 'dashboard';
  const go = (key: string) => isSection(key) && setParams(key === 'dashboard' ? {} : { section: key }, { replace: true });

  const sections = [
    { key: 'dashboard' as const, label: t('admin.dashboard'), icon: LayoutDashboard },
    { key: 'users' as const, label: t('admin.users'), icon: Users },
    { key: 'institutions' as const, label: t('admin.institutions'), icon: Building2 },
    { key: 'models' as const, label: t('settings.models'), icon: Cpu },
    { key: 'sandbox' as const, label: t('admin.sandbox'), icon: Box },
    { key: 'email' as const, label: t('admin.email'), icon: Mail },
    { key: 'push' as const, label: t('admin.push'), icon: Bell },
    { key: 'billing' as const, label: t('admin.billing'), icon: CreditCard },
    { key: 'settings' as const, label: t('admin.settings'), icon: Settings },
    { key: 'logs' as const, label: t('admin.logs'), icon: ScrollText },
  ];

  return (
    <Page title={t('nav.adminPanel')} wide>
      <SectionLayout heading={t('nav.adminPanel')} sections={sections} active={active} onSelect={go}>
        {active === 'dashboard' && <DashboardSection onGo={go} />}
        {active === 'users' && <UsersSection />}
        {active === 'institutions' && <InstitutionsSection />}
        {active === 'models' && <ModelsAdminSection />}
        {active === 'sandbox' && <SandboxSection />}
        {active === 'email' && <EmailSection />}
        {active === 'push' && <PushAdminSection />}
        {active === 'billing' && <BillingSection />}
        {active === 'settings' && <GeneralSection />}
        {active === 'logs' && <LogsSection />}
      </SectionLayout>
    </Page>
  );
};

export default AdminPage;
