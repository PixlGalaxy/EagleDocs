import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2, CircleAlert, Gpu, Loader2, RefreshCw } from 'lucide-react';
import { adminApi, type LabInfo, type LabSettings } from '../../api/admin';
import { ApiError } from '../../api/client';
import { useI18n } from '../../i18n/I18nContext';
import { Field, Notice, Panel, Skeleton, Switch } from '../../components/ui/kit';
import { btn, input } from '../../components/ui/styles';

/** The GPU's queue (plans/13): which servers and models it uses, and how the queue is doing. */
const LabSection = () => {
  const { t } = useI18n();
  const [info, setInfo] = useState<LabInfo | null>(null);
  const [draft, setDraft] = useState<LabSettings | null>(null);
  const [models, setModels] = useState<{ list: string[]; error: string | null }>({ list: [], error: null });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const load = useCallback(() => {
    void adminApi
      .lab()
      .then((i) => {
        setInfo(i);
        setDraft((d) => d ?? i.settings);
      })
      .catch(() => undefined);
    void adminApi
      .labModels()
      .then((m) => setModels({ list: m.models.map((x) => x.name), error: m.error }))
      .catch(() => undefined);
  }, []);
  useEffect(load, [load]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    setBusy(true);
    setResult(null);
    try {
      const { settings } = await adminApi.saveLab(draft);
      setDraft(settings);
      setResult({ ok: true, message: t('common.saved') });
      load();
    } catch (err) {
      setResult({ ok: false, message: err instanceof ApiError ? err.message : t('common.networkError') });
    } finally {
      setBusy(false);
    }
  };

  if (!info || !draft) return <Skeleton className="h-64 rounded-xl" />;
  const set = (patch: Partial<LabSettings>) => setDraft({ ...draft, ...patch });
  const text = (key: keyof LabSettings, placeholder: string, list?: string) => (id: string, d?: string) => (
    <input
      id={id}
      aria-describedby={d}
      value={String(draft[key])}
      onChange={(e) => set({ [key]: e.target.value })}
      placeholder={placeholder}
      list={list}
      autoComplete="off"
      spellCheck={false}
      className={`${input} font-mono`}
    />
  );
  const q = info.queue;

  return (
    <>
      <Panel title={t('admin.labTitle')} description={t('admin.labBody')}>
        <form onSubmit={(e) => void save(e)} className="grid gap-5 sm:grid-cols-2">
          <div className="flex items-center justify-between gap-4 sm:col-span-2">
            <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{t('admin.labEnabled')}</span>
            <Switch checked={draft.enabled} onChange={(enabled) => set({ enabled })} label={t('admin.labEnabled')} />
          </div>
          <div className="sm:col-span-2">
            <Notice tone="neutral" icon={Gpu}>
              {t('admin.labNetwork')}
            </Notice>
          </div>
          <Field label={t('admin.labOllamaUrl')} hint={models.error ? t('admin.labModelsError', { error: models.error }) : undefined}>
            {text('ollama_url', 'http://ollama:11434')}
          </Field>
          <Field label={t('admin.labMaxQueued')} hint={t('admin.labMaxQueuedHint')}>
            {(id, d) => (
              <input
                id={id}
                aria-describedby={d}
                type="number"
                min={1}
                max={10000}
                value={draft.max_queued_per_user}
                onChange={(e) => set({ max_queued_per_user: Number(e.target.value) })}
                className={`${input} font-mono`}
              />
            )}
          </Field>
          <Field label={t('admin.labVisionModel')} hint={t('admin.labVisionHint')}>
            {text('vision_model', 'qwen2.5vl:3b', 'lab-models')}
          </Field>
          <Field label={t('admin.labTextModel')} hint={t('admin.labTextHint')}>
            {text('text_model', 'qwen3:4b-instruct', 'lab-models')}
          </Field>
          <Field label={t('admin.labWhisperUrl')} hint={t('admin.labWhisperHint')}>
            {text('whisper_url', 'http://whisper:8080')}
          </Field>
          <Field label={t('admin.labWhisperModel')}>{text('whisper_model', 'whisper-1')}</Field>
          <datalist id="lab-models">
            {models.list.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          {result && (
            <div className="sm:col-span-2">
              <Notice tone={result.ok ? 'success' : 'danger'} icon={result.ok ? CheckCircle2 : CircleAlert}>
                {result.message}
              </Notice>
            </div>
          )}
          <div className="sm:col-span-2">
            <button type="submit" disabled={busy} className={btn.primary}>
              {busy && <Loader2 size={16} className="animate-spin" />}
              {t('common.save')}
            </button>
          </div>
        </form>
      </Panel>

      <Panel
        title={t('admin.labQueueTitle')}
        description={q.worker_node ? t('admin.labWorker', { node: q.worker_node }) : t('admin.labNoWorker')}
        actions={
          <button type="button" onClick={load} className={btn.secondary} aria-label={t('common.refresh')}>
            <RefreshCw size={16} aria-hidden="true" />
          </button>
        }
      >
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {[
            [t('admin.labQueued'), q.queued],
            [t('admin.labRunning'), q.running],
            [t('admin.labDone'), q.done_day],
            [t('admin.labFailed'), q.failed_day],
            [t('admin.labGpuMinutes'), q.gpu_minutes_day],
            [t('admin.labAvgWait'), q.avg_wait_seconds === null ? '—' : `${q.avg_wait_seconds} s`],
          ].map(([label, value]) => (
            <div key={String(label)}>
              <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
              <dd className="mt-0.5 font-mono text-sm font-medium text-slate-900 dark:text-slate-100">{value}</dd>
            </div>
          ))}
        </dl>
      </Panel>
    </>
  );
};

export default LabSection;
