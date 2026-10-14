import { useEffect, useState, type FormEvent } from 'react';
import { CircleAlert, Loader2, Plus, RefreshCw, Server, Trash2 } from 'lucide-react';
import { adminApi, type AdminModel, type GeneralSettings, type ModelEndpoint } from '../../api/admin';
import { ApiError } from '../../api/client';
import { useConfirm } from '../../components/ui/confirm';
import { useI18n } from '../../i18n/I18nContext';
import Modal from '../../components/ui/Modal';
import { Badge, EmptyState, Field, Notice, Panel, Skeleton, Switch } from '../../components/ui/kit';
import { btn, card, input } from '../../components/ui/styles';

// "embedding": the model RAGs use to index files (never offered in the chat picker).
const TAGS = ['fast', 'smart', 'code', 'vision', 'embedding'] as const;

function ModelRow({ model, onChange }: { model: AdminModel; onChange: (m: AdminModel) => void }) {
  const { t } = useI18n();
  const update = (patch: Partial<AdminModel>) => void adminApi.updateModel(model.id, patch).then(onChange);
  return (
    <li className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-sm text-slate-800 dark:text-slate-200">{model.model_name}</p>
        <label className="mt-1 block">
          <span className="sr-only">{t('admin.displayName')}</span>
          <input defaultValue={model.display_name} onBlur={(e) => e.target.value !== model.display_name && update({ display_name: e.target.value })} className={`${input} max-w-xs py-1.5`} />
        </label>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('admin.tags')}>
        {TAGS.map((tag) => {
          const on = model.tags.includes(tag);
          return (
            <button
              key={tag}
              type="button"
              aria-pressed={on}
              onClick={() => update({ tags: on ? model.tags.filter((x) => x !== tag) : [...model.tags, tag] })}
              className={`rounded-md border px-2 py-1 text-xs font-medium transition ${on ? 'border-[var(--accent-500)] bg-[var(--accent-50)] text-[var(--accent-800)] dark:bg-[var(--accent-500)]/15 dark:text-[var(--accent-200)]' : 'border-slate-300 text-slate-500 dark:border-slate-600'}`}
            >
              {tag}
            </button>
          );
        })}
      </div>
      <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
        {t('admin.tools')}
        <Switch label={t('admin.tools')} checked={model.supports_tools} onChange={(on) => update({ supports_tools: on })} />
      </label>
      <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
        {t('admin.enabled')}
        <Switch label={t('admin.enabled')} checked={model.enabled} onChange={(on) => update({ enabled: on })} />
      </label>
    </li>
  );
}

const ModelsAdminSection = () => {
  const { t } = useI18n();
  const ask = useConfirm();
  const [endpoints, setEndpoints] = useState<ModelEndpoint[] | null>(null);
  const [general, setGeneral] = useState<GeneralSettings | null>(null);
  const [draft, setDraft] = useState<{ name: string; base_url: string; kind: ModelEndpoint['kind']; api_key: string } | null>(null);
  const [discovering, setDiscovering] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    void adminApi.endpoints().then(setEndpoints).catch(() => setEndpoints([]));
    void adminApi.general().then(setGeneral).catch(() => undefined);
  }, []);

  const replace = (ep: ModelEndpoint) => setEndpoints((prev) => [...(prev ?? []).filter((e) => e.id !== ep.id), ep]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    setError('');
    try {
      const saved = await adminApi.saveEndpoint({ ...draft, api_key: draft.api_key || undefined });
      replace(saved);
      setDraft(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.networkError'));
    }
  };

  return (
    <>
      <Panel
        title={t('admin.modelsTitle')}
        description={t('admin.modelsBody')}
        actions={
          <button type="button" onClick={() => setDraft({ name: '', base_url: 'http://', kind: 'ollama', api_key: '' })} className={btn.primary}>
            <Plus size={16} aria-hidden="true" />
            {t('admin.addEndpoint')}
          </button>
        }
      >
        {endpoints === null ? (
          <Skeleton className="h-32" />
        ) : endpoints.length === 0 ? (
          <EmptyState icon={Server} title={t('admin.noEndpoints')} description={t('admin.noEndpointsBody')} />
        ) : (
          <div className="space-y-4">
            {endpoints.map((ep) => (
              <div key={ep.id} className={`${card} p-4`}>
                <div className="flex flex-wrap items-center gap-3">
                  <Server size={18} className="text-slate-400" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-900 dark:text-slate-100">{ep.name}</p>
                    <p className="truncate font-mono text-xs text-slate-500">{ep.base_url}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setDiscovering(ep.id);
                      void adminApi
                        .discoverModels(ep.id)
                        .then(replace)
                        .finally(() => setDiscovering(null));
                    }}
                    className={btn.secondary}
                  >
                    {discovering === ep.id ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} aria-hidden="true" />}
                    {t('admin.discover')}
                  </button>
                  <button type="button" onClick={() => ask(() => void adminApi.deleteEndpoint(ep.id).then(() => setEndpoints((prev) => prev?.filter((x) => x.id !== ep.id) ?? null)))} className={btn.iconDanger} aria-label={t('common.delete')}>
                    <Trash2 size={16} />
                  </button>
                </div>
                {ep.models.length > 0 ? (
                  <ul className="mt-3 divide-y divide-slate-100 border-t border-slate-100 dark:divide-slate-800 dark:border-slate-800">
                    {ep.models.map((m) => (
                      <ModelRow key={m.id} model={m} onChange={(updated) => replace({ ...ep, models: ep.models.map((x) => (x.id === updated.id ? updated : x)) })} />
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-sm text-slate-500">{t('admin.noModelsYet')}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>

      {general && (
        <Panel
          title={t('admin.codexTitle')}
          description={t('admin.codexBody')}
          actions={
            <Switch
              label={t('admin.codexTitle')}
              checked={general.codex_enabled}
              onChange={(on) => {
                setGeneral({ ...general, codex_enabled: on });
                void adminApi.saveGeneral({ codex_enabled: on });
              }}
            />
          }
        >
          {general.codex_disabled_until ? (
            <div className="flex flex-wrap items-center gap-3">
              <Badge tone="danger">{t('admin.codexTripped', { date: new Date(general.codex_disabled_until).toLocaleString() })}</Badge>
              <button
                type="button"
                className={btn.secondary}
                onClick={() => void adminApi.saveGeneral({ codex_disabled_until: null }).then(setGeneral)}
              >
                {t('admin.codexReset')}
              </button>
            </div>
          ) : (
            <Badge tone="success">{t('admin.codexHealthy')}</Badge>
          )}
        </Panel>
      )}

      {general && (
        <Panel title={t('admin.quotaTitle')} description={t('admin.quotaBody')}>
          <div className="flex max-w-xs items-end gap-2">
            <Field label={t('admin.dailyMessages')}>
              {(id) => (
                <input
                  id={id}
                  type="number"
                  min={0}
                  value={general.eagledocs_daily_messages}
                  onChange={(e) => setGeneral({ ...general, eagledocs_daily_messages: Number(e.target.value) })}
                  className={`${input} font-mono`}
                />
              )}
            </Field>
            <button type="button" onClick={() => void adminApi.saveGeneral({ eagledocs_daily_messages: general.eagledocs_daily_messages })} className={btn.primary}>
              {t('common.save')}
            </button>
          </div>
        </Panel>
      )}

      {draft && (
        <Modal title={t('admin.addEndpoint')} onClose={() => setDraft(null)}>
          <form onSubmit={(e) => void save(e)} className="space-y-5">
            <Field label={t('admin.endpointKind')}>
              {(id) => (
                <select id={id} value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as ModelEndpoint['kind'] })} className={input}>
                  <option value="ollama">Ollama</option>
                  <option value="openai_compat">OpenAI-compatible (vLLM, LM Studio...)</option>
                </select>
              )}
            </Field>
            <Field label={t('admin.endpointName')}>
              {(id) => <input id={id} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={input} required placeholder="Zaylar GPU" />}
            </Field>
            <Field label={t('models.baseUrl')} hint={draft.kind === 'ollama' ? 'http://192.168.0.150:11434' : 'http://host:8000/v1'}>
              {(id, d) => <input id={id} aria-describedby={d} type="url" value={draft.base_url} onChange={(e) => setDraft({ ...draft, base_url: e.target.value })} className={`${input} font-mono`} required />}
            </Field>
            {draft.kind === 'openai_compat' && (
              <Field label={t('models.apiKey')}>
                {(id) => <input id={id} type="password" autoComplete="off" value={draft.api_key} onChange={(e) => setDraft({ ...draft, api_key: e.target.value })} className={`${input} font-mono`} />}
              </Field>
            )}
            {error && (
              <Notice tone="danger" icon={CircleAlert}>
                {error}
              </Notice>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setDraft(null)} className={btn.secondary}>
                {t('common.cancel')}
              </button>
              <button type="submit" className={btn.primary}>
                {t('common.save')}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
};

export default ModelsAdminSection;
