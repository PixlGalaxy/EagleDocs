import { Download } from 'lucide-react';
import { dataExportApi } from '../../api/account';
import { useI18n } from '../../i18n/I18nContext';
import { Panel } from '../../components/ui/kit';
import { btn } from '../../components/ui/styles';

/**
 * "Export my data": one ZIP with the profile, chats, memory, skills, scheduled tasks and files. A plain link,
 * so the browser streams the archive to disk however large it is (Settings → Account and the deletion screen).
 */
const ExportDataPanel = ({ className }: { className?: string }) => {
  const { t } = useI18n();
  return (
    <Panel title={t('dataExport.title')} description={t('dataExport.body')} className={className}>
      <div className="flex flex-wrap items-center gap-3">
        <a href={dataExportApi.downloadUrl()} download className={btn.secondary}>
          <Download size={16} aria-hidden="true" />
          {t('dataExport.download')}
        </a>
        <span className="text-sm text-slate-500 dark:text-slate-400">{t('dataExport.hint')}</span>
      </div>
    </Panel>
  );
};

export default ExportDataPanel;
