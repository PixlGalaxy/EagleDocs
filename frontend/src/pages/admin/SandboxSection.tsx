import { useEffect, useState } from 'react';
import { Box, Loader2, Square } from 'lucide-react';
import { adminApi, type NodeRow, type SandboxRow, type SandboxSettings } from '../../api/admin';
import { useConfirm } from '../../components/ui/confirm';
import { useI18n } from '../../i18n/I18nContext';
import Toast from '../../components/ui/Toast';
import { Badge, EmptyState, Field, Panel, Skeleton } from '../../components/ui/kit';
import { btn, input } from '../../components/ui/styles';

function ago(iso: string, language: string): string {
  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(language, { numeric: 'auto' });
  if (Math.abs(seconds) < 60) return rtf.format(seconds, 'second');
  if (Math.abs(seconds) < 3600) return rtf.format(Math.round(seconds / 60), 'minute');
  return rtf.format(Math.round(seconds / 3600), 'hour');
}

const SandboxSection = () => {
  const { t, language } = useI18n();
  const ask = useConfirm();
  const [settings, setSettings] = useState<SandboxSettings | null>(null);
  const [nodes, setNodes] = useState<NodeRow[] | null>(null);
  const [sandboxes, setSandboxes] = useState<SandboxRow[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => {
    void adminApi.sandbox().then(setSettings).catch(() => undefined);
    const live = () => {
      void adminApi.nodes().then(setNodes).catch(() => setNodes([]));
      void adminApi.sandboxes().then(setSandboxes).catch(() => setSandboxes([]));
    };
    live();
    const timer = setInterval(live, 10000);
    return () => clearInterval(timer);
  }, []);

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      setSettings(await adminApi.saveSandbox(settings));
      setToast(t('common.saved'));
      setTimeout(() => setToast(''), 2500);
    } finally {
      setSaving(false);
    }
  };

  const num = (key: keyof SandboxSettings) => (e: React.ChangeEvent<HTMLInputElement>) => settings && setSettings({ ...settings, [key]: Number(e.target.value) });

  return (
    <>
      <Panel title={t('admin.nodesTitle')} description={t('admin.nodesBody')}>
        {nodes === null ? (
          <Skeleton className="h-20" />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {nodes.map((node) => (
              <li key={node.id} className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate font-mono text-sm font-medium text-slate-900 dark:text-slate-100">{node.id}</p>
                  <Badge tone={node.online ? 'success' : 'danger'}>{node.online ? t('admin.online') : t('admin.offline')}</Badge>
                </div>
                <p className="mt-1 truncate text-xs text-slate-500">
                  {node.hostname} · v{node.version}
                </p>
                <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">
                  {t('admin.nodeLoad', { sandboxes: node.sandboxes_active, jobs: node.jobs_running })} · {ago(node.heartbeat_at, language)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={t('admin.sandboxLimits')} description={t('admin.sandboxLimitsBody')}>
        {!settings ? (
          <Skeleton className="h-40" />
        ) : (
          <div className="space-y-5">
            <div className="grid gap-5 sm:grid-cols-3">
              <Field label={t('admin.cpu')} hint={t('admin.cpuHint')}>
                {(id, d) => <input id={id} aria-describedby={d} type="number" step={0.25} min={0.25} value={settings.default_cpu} onChange={num('default_cpu')} className={`${input} font-mono`} />}
              </Field>
              <Field label={t('admin.memMb')}>
                {(id) => <input id={id} type="number" step={128} min={256} value={settings.default_mem_mb} onChange={num('default_mem_mb')} className={`${input} font-mono`} />}
              </Field>
              <Field label={t('admin.diskMb')}>
                {(id) => <input id={id} type="number" step={256} min={256} value={settings.default_disk_mb} onChange={num('default_disk_mb')} className={`${input} font-mono`} />}
              </Field>
              <Field label={t('admin.maxActive')} hint={t('admin.maxActiveHint')}>
                {(id, d) => <input id={id} aria-describedby={d} type="number" min={1} value={settings.max_active_per_node} onChange={num('max_active_per_node')} className={`${input} font-mono`} />}
              </Field>
              <Field label={t('admin.idle')}>
                {(id) => <input id={id} type="number" min={1} value={settings.idle_timeout_minutes} onChange={num('idle_timeout_minutes')} className={`${input} font-mono`} />}
              </Field>
              <Field label={t('admin.network')}>
                {(id) => (
                  <select id={id} value={settings.network} onChange={(e) => setSettings({ ...settings, network: e.target.value as SandboxSettings['network'] })} className={input}>
                    <option value="open">{t('admin.netOpen')}</option>
                    <option value="blocklist">{t('admin.netBlock')}</option>
                    <option value="allowlist">{t('admin.netAllow')}</option>
                  </select>
                )}
              </Field>
            </div>
            {settings.network !== 'open' && (
              <Field label={settings.network === 'allowlist' ? t('admin.netAllowList') : t('admin.netBlockList')} hint={t('admin.netListHint')}>
                {(id, d) => (
                  <textarea
                    id={id}
                    aria-describedby={d}
                    rows={4}
                    value={settings.network_list.join('\n')}
                    onChange={(e) => setSettings({ ...settings, network_list: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })}
                    className={`${input} font-mono`}
                  />
                )}
              </Field>
            )}
            <Field label={t('admin.image')}>
              {(id) => <input id={id} value={settings.image} onChange={(e) => setSettings({ ...settings, image: e.target.value })} className={`${input} font-mono`} />}
            </Field>
            <button type="button" onClick={() => void save()} disabled={saving} className={btn.primary}>
              {saving && <Loader2 size={16} className="animate-spin" />}
              {t('common.save')}
            </button>
          </div>
        )}
      </Panel>

      <Panel title={t('admin.activeSandboxes')}>
        {sandboxes === null ? (
          <Skeleton className="h-24" />
        ) : sandboxes.length === 0 ? (
          <EmptyState icon={Box} title={t('admin.noSandboxes')} />
        ) : (
          <div className="-mx-5 overflow-x-auto sm:-mx-6">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-y border-slate-200 bg-slate-50 text-left text-xs font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
                <tr>
                  <th className="px-5 py-2.5 sm:px-6">{t('admin.colUser')}</th>
                  <th className="px-3 py-2.5">{t('admin.node')}</th>
                  <th className="px-3 py-2.5">CPU</th>
                  <th className="px-3 py-2.5">RAM</th>
                  <th className="px-3 py-2.5">{t('admin.disk')}</th>
                  <th className="px-5 py-2.5 sm:px-6">
                    <span className="sr-only">{t('files.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono text-xs dark:divide-slate-800">
                {sandboxes.map((s) => (
                  <tr key={s.user_id}>
                    <td className="px-5 py-2.5 font-sans text-sm sm:px-6">{s.username}</td>
                    <td className="px-3 py-2.5">{s.node_id}</td>
                    <td className="px-3 py-2.5">{s.cpu_percent !== null ? `${s.cpu_percent.toFixed(0)}%` : '-'}</td>
                    <td className="px-3 py-2.5">{s.mem_mb !== null ? `${s.mem_mb} / ${s.mem_limit_mb} MB` : '-'}</td>
                    <td className="px-3 py-2.5">
                      {s.disk_used_mb} / {s.disk_limit_mb} MB
                    </td>
                    <td className="px-5 py-2.5 text-right sm:px-6">
                      <button type="button" onClick={() => ask(() => void adminApi.stopSandbox(s.user_id))} className={btn.iconDanger} aria-label={t('admin.stop')}>
                        <Square size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {toast && <Toast message={toast} />}
    </>
  );
};

export default SandboxSection;
