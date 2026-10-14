import { useEffect, useState } from 'react';
import { Check, CircleAlert, Copy, Plug, Unplug } from 'lucide-react';
import { mcpApi } from '../../api/account';
import { ApiError } from '../../api/client';
import type { McpInfo, McpScope } from '../../api/types';
import { useConfirm } from '../../components/ui/confirm';
import { useI18n } from '../../i18n/I18nContext';
import type { TranslationKey } from '../../i18n/translations';
import { BRAND_MARKS } from '../../components/brandMarks';
import { Badge, EmptyState, Notice, Panel, Skeleton } from '../../components/ui/kit';
import { btn, input } from '../../components/ui/styles';

// eslint-disable-next-line react-refresh/only-export-components
export const SCOPE_LABEL: Record<McpScope, TranslationKey> = {
  'canvas.read': 'apps.scopeCanvas',
  'degreeworks.read': 'apps.scopeDegreeworks',
  workspace: 'apps.scopeWorkspace',
  memory: 'apps.scopeMemory',
};

function Mark({ name }: { name: 'openai' | 'claude' }) {
  const mark = BRAND_MARKS[name]!;
  return (
    <svg viewBox={mark.viewBox} width={22} height={22} fill="currentColor" fillRule="evenodd" aria-hidden="true">
      {mark.paths.map((d) => (
        <path key={d.slice(0, 24)} d={d} />
      ))}
    </svg>
  );
}

/** Settings -> Apps: use EagleDocs from ChatGPT, Claude or any MCP client. */
const AppsSection = () => {
  const { t, language } = useI18n();
  const ask = useConfirm();
  const [info, setInfo] = useState<McpInfo | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    mcpApi
      .info()
      .then(setInfo)
      .catch((err) => setError(err instanceof ApiError ? err.message : t('common.networkError')));
  }, [t]);

  const copy = async () => {
    if (!info) return;
    try {
      await navigator.clipboard.writeText(info.server_url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked: the URL is selectable in the field.
    }
  };

  if (error)
    return (
      <Notice tone="danger" icon={CircleAlert}>
        {error}
      </Notice>
    );
  if (!info) return <Skeleton className="h-64 rounded-xl" />;
  if (!info.enabled)
    return (
      <Notice tone="neutral" icon={Plug}>
        {t('apps.disabled')}
      </Notice>
    );

  const guides: { mark: 'openai' | 'claude'; title: TranslationKey; steps: TranslationKey[] }[] = [
    { mark: 'openai', title: 'apps.chatgptTitle', steps: ['apps.chatgptStep1', 'apps.chatgptStep2', 'apps.chatgptStep3'] },
    { mark: 'claude', title: 'apps.claudeTitle', steps: ['apps.claudeStep1', 'apps.claudeStep2', 'apps.claudeStep3'] },
  ];

  return (
    <>
      <Panel title={t('apps.title')} description={t('apps.body')}>
        <label htmlFor="mcp-url" className="text-sm font-medium text-slate-700 dark:text-slate-300">
          {t('apps.serverUrl')}
        </label>
        <div className="mt-1.5 flex gap-2">
          <input id="mcp-url" readOnly value={info.server_url} onFocus={(e) => e.target.select()} className={`${input} font-mono`} />
          <button type="button" onClick={() => void copy()} className={btn.secondary}>
            {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
            {copied ? t('common.copied') : t('common.copy')}
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{t('apps.sharedHint')}</p>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {guides.map((g) => (
            <div key={g.mark} className="rounded-xl border border-slate-200 p-5 dark:border-slate-700">
              <h3 className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
                <Mark name={g.mark} />
                {t(g.title)}
              </h3>
              <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-slate-600 dark:text-slate-300">
                {g.steps.map((s) => (
                  <li key={s}>{t(s)}</li>
                ))}
              </ol>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">{t('apps.otherClients')}</p>
      </Panel>

      <Panel title={t('apps.connectedTitle')} description={t('apps.connectedBody')}>
        {info.apps.length === 0 ? (
          <EmptyState icon={Plug} title={t('apps.noneTitle')} description={t('apps.noneBody')} />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {info.apps.map((app) => (
              <li key={app.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-900 dark:text-slate-100">{app.client_name}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {app.last_used_at
                      ? t('apps.lastUsed', { date: new Date(app.last_used_at).toLocaleString(language, { dateStyle: 'medium', timeStyle: 'short' }) })
                      : t('apps.neverUsed')}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {app.scopes.map((s) => (
                      <Badge key={s}>{t(SCOPE_LABEL[s])}</Badge>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  className={btn.secondary}
                  onClick={() =>
                    ask(() => void mcpApi.revoke(app.id).then(() => setInfo({ ...info, apps: info.apps.filter((a) => a.id !== app.id) })), {
                      title: t('apps.revokeTitle', { name: app.client_name }),
                      body: t('apps.revokeBody'),
                      confirmLabel: t('apps.revoke'),
                    })
                  }
                >
                  <Unplug size={16} aria-hidden="true" />
                  {t('apps.revoke')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
};

export default AppsSection;
