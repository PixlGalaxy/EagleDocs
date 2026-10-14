import { useEffect, useState } from 'react';
import { AlertTriangle, CircleAlert } from 'lucide-react';
import { adminApi, type AdminOverview, type NodeRow, type SystemInfo } from '../../api/admin';
import { useI18n } from '../../i18n/I18nContext';
import { Badge, Notice, Panel, Skeleton } from '../../components/ui/kit';
import { card } from '../../components/ui/styles';

const DashboardSection = ({ onGo }: { onGo: (section: string) => void }) => {
  const { t } = useI18n();
  const [data, setData] = useState<AdminOverview | null>(null);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [nodes, setNodes] = useState<NodeRow[]>([]);

  useEffect(() => {
    const load = () => {
      void adminApi.overview().then(setData).catch(() => undefined);
      void adminApi.system().then(setSystem).catch(() => undefined);
      void adminApi.nodes().then(setNodes).catch(() => undefined);
    };
    load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, []);

  if (!data)
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
    );

  const stats = [
    { label: t('admin.statUsers'), value: data.users.total, sub: t('admin.statUsersSub', { active: data.users.active, pending: data.users.pending }) },
    { label: t('admin.statChats'), value: data.chats_today },
    { label: t('admin.statJobs'), value: data.jobs_running },
    { label: t('admin.statSandboxes'), value: data.sandboxes_active },
    { label: t('admin.statNodes'), value: data.nodes_online },
  ];

  return (
    <>
      {data.alerts.length > 0 && (
        <div className="space-y-2">
          {data.alerts.map((alert, i) => (
            <Notice key={i} tone={alert.level === 'error' ? 'danger' : 'warning'} icon={alert.level === 'error' ? CircleAlert : AlertTriangle}>
              {alert.message}{' '}
              {alert.section && (
                <button type="button" onClick={() => onGo(alert.section!)} className="font-medium underline underline-offset-2">
                  {t('admin.fix')}
                </button>
              )}
            </Notice>
          ))}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {stats.map((stat) => (
          <div key={stat.label} className={`${card} p-5`}>
            <p className="text-sm text-slate-500 dark:text-slate-400">{stat.label}</p>
            <p className="mt-1 font-mono text-3xl font-semibold text-slate-900 dark:text-white">{stat.value}</p>
            {stat.sub && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{stat.sub}</p>}
          </div>
        ))}
      </div>
      {system && <SystemPanel system={system} nodes={nodes} />}
    </>
  );
};

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const SystemPanel = ({ system, nodes }: { system: SystemInfo; nodes: NodeRow[] }) => {
  const { t, language } = useI18n();
  const rows: [string, string][] = [
    [t('admin.sysVersion'), `${system.version} (${system.image_ref}${system.image_revision ? ` @ ${system.image_revision.slice(0, 7)}` : ''})`],
    [t('admin.sysThisServer'), `${system.node_id} · Node ${system.node_version} · ${formatUptime(system.uptime_seconds)} · ${system.memory_mb} MB`],
    [t('admin.sysDatabase'), `PostgreSQL ${system.database.version} · ${system.database.size_mb} MB · ${t('admin.sysMigrations', { count: system.database.migrations })}`],
  ];
  return (
    <Panel title={t('admin.system')} description={t('admin.systemHint')} className="mt-4">
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
            <dd className="font-mono text-slate-800 dark:text-slate-200">{value}</dd>
          </div>
        ))}
      </dl>
      {nodes.length > 0 && (
        <div className="mt-5 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
              <tr>
                <th className="py-2 pr-4 font-medium">{t('admin.sysServer')}</th>
                <th className="py-2 pr-4 font-medium">{t('admin.sysState')}</th>
                <th className="py-2 pr-4 font-medium">{t('admin.statJobs')}</th>
                <th className="py-2 font-medium">{t('admin.sysHeartbeat')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {nodes.map((node) => (
                <tr key={node.id}>
                  <td className="py-2 pr-4 font-mono">{node.id}</td>
                  <td className="py-2 pr-4">
                    <Badge tone={node.online ? 'success' : 'neutral'}>{t(node.online ? 'admin.sysOnline' : 'admin.sysOffline')}</Badge>
                  </td>
                  <td className="py-2 pr-4 font-mono tabular-nums">{node.jobs_running}</td>
                  <td className="py-2 tabular-nums text-slate-500 dark:text-slate-400">
                    {new Intl.DateTimeFormat(language, { timeStyle: 'medium' }).format(new Date(node.heartbeat_at))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
};

export default DashboardSection;
