import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { CircleAlert, Copy, ExternalLink, KeyRound, Loader2, Plus, Server, Sparkles, Trash2, Wand2 } from 'lucide-react';
import { connectionsApi } from '../../api/account';
import { modelsApi } from '../../api/chat';
import { ApiError } from '../../api/client';
import type { CodexDeviceStart, Connection, ModelOption, ModelTier, UserModelPrefs } from '../../api/types';
import { useConfirm } from '../../components/ui/confirm';
import { useI18n } from '../../i18n/I18nContext';
import { useAppConfig } from '../../context/AppConfigContext';
import type { TranslationKey } from '../../i18n/translations';
import Modal from '../../components/ui/Modal';
import Toast from '../../components/ui/Toast';
import { Badge, Field, Notice, Panel, Skeleton } from '../../components/ui/kit';
import { btn, input } from '../../components/ui/styles';
import { StatusBadge } from './ConnectionsSection';
import BrandLoader from '../../components/ui/BrandLoader';

const PROVIDERS: { id: string; label: string; needsBaseUrl?: boolean }[] = [
  { id: 'openai', label: 'OpenAI' },
  { id: 'anthropic', label: 'Anthropic (Claude)' },
  { id: 'deepseek', label: 'DeepSeek' },
  { id: 'openrouter', label: 'OpenRouter' },
  { id: 'google', label: 'Google Gemini' },
  { id: 'openai_compat', label: 'OpenAI-compatible', needsBaseUrl: true },
];

const TIERS: { id: ModelTier; label: TranslationKey; hint: TranslationKey }[] = [
  { id: 'fast', label: 'models.tierFast', hint: 'models.tierFastHint' },
  { id: 'smart', label: 'models.tierSmart', hint: 'models.tierSmartHint' },
  { id: 'code', label: 'models.tierCode', hint: 'models.tierCodeHint' },
  { id: 'vision', label: 'models.tierVision', hint: 'models.tierVisionHint' },
];

function CodexConnectModal({ onClose, onConnected }: { onClose: () => void; onConnected: (c: Connection) => void }) {
  const { t } = useI18n();
  const [start, setStart] = useState<CodexDeviceStart | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    modelsApi
      .codexStart()
      .then((s) => !cancelled && setStart(s))
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : t('common.networkError')));
    return () => {
      cancelled = true;
    };
  }, [t]);

  useEffect(() => {
    if (!start) return;
    const poll = () => {
      modelsApi
        .codexPoll(start.device_auth_id)
        .then((res) => {
          if (res.status === 'connected' && res.connection) onConnected(res.connection);
          else if (res.status === 'expired') setError(t('models.codexExpired'));
          else timer.current = setTimeout(poll, start.interval * 1000);
        })
        .catch(() => {
          timer.current = setTimeout(poll, start.interval * 1000);
        });
    };
    timer.current = setTimeout(poll, start.interval * 1000);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [start, onConnected, t]);

  const copy = async () => {
    if (!start) return;
    try {
      await navigator.clipboard.writeText(start.user_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked: the code is still visible to type by hand.
    }
  };

  return (
    <Modal title={t('models.codexConnect')} onClose={onClose}>
      {error ? (
        <Notice tone="danger" icon={CircleAlert}>
          {error}
        </Notice>
      ) : !start ? (
        <p className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <BrandLoader size={22} />
          {t('models.codexStarting')}
        </p>
      ) : (
        <ol className="space-y-5 text-sm text-slate-700 dark:text-slate-300">
          <li>
            <p className="font-medium text-slate-900 dark:text-slate-100">{t('models.codexStep1')}</p>
            <a href={start.verification_uri} target="_blank" rel="noopener noreferrer" className={`${btn.secondary} mt-2`}>
              <ExternalLink size={16} aria-hidden="true" />
              {start.verification_uri.replace(/^https?:\/\//, '')}
            </a>
          </li>
          <li>
            <p className="font-medium text-slate-900 dark:text-slate-100">{t('models.codexStep2')}</p>
            <div className="mt-2 flex items-center gap-2">
              <code className="rounded-lg border border-slate-300 bg-slate-50 px-4 py-2 font-mono text-xl tracking-[0.2em] text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white">{start.user_code}</code>
              <button type="button" onClick={() => void copy()} className={btn.iconGhost} aria-label={t('common.copy')}>
                <Copy size={18} />
              </button>
              {copied && <span className="text-xs text-emerald-600">{t('common.copied')}</span>}
            </div>
          </li>
          <li className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
            <BrandLoader size={22} />
            {t('models.codexWaiting')}
          </li>
        </ol>
      )}
    </Modal>
  );
}

function ApiKeyModal({ onClose, onSaved }: { onClose: () => void; onSaved: (c: Connection) => void }) {
  const { t } = useI18n();
  const [form, setForm] = useState({ provider: 'openai', label: '', api_key: '', base_url: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const provider = PROVIDERS.find((p) => p.id === form.provider)!;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      onSaved(
        await modelsApi.addApiKey({
          provider: form.provider,
          label: form.label.trim() || provider.label,
          api_key: form.api_key.trim(),
          base_url: provider.needsBaseUrl ? form.base_url.trim() : undefined,
        }),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.networkError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t('models.addKey')} onClose={onClose}>
      <form onSubmit={(e) => void submit(e)} className="space-y-5">
        <Field label={t('models.provider')}>
          {(id) => (
            <select id={id} value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} className={input}>
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          )}
        </Field>
        {provider.needsBaseUrl && (
          <Field label={t('models.baseUrl')} hint="https://api.example.com/v1">
            {(id, d) => <input id={id} aria-describedby={d} type="url" value={form.base_url} onChange={(e) => setForm({ ...form, base_url: e.target.value })} className={input} required />}
          </Field>
        )}
        <Field label={t('models.keyLabel')} hint={t('models.keyLabelHint')}>
          {(id, d) => <input id={id} aria-describedby={d} value={form.label} placeholder={provider.label} onChange={(e) => setForm({ ...form, label: e.target.value })} className={input} />}
        </Field>
        <Field label={t('models.apiKey')} hint={t('models.apiKeyHint')}>
          {(id, d) => <input id={id} aria-describedby={d} type="password" autoComplete="off" spellCheck={false} value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })} className={`${input} font-mono`} required />}
        </Field>
        {error && (
          <Notice tone="danger" icon={CircleAlert}>
            {error}
          </Notice>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btn.secondary}>
            {t('common.cancel')}
          </button>
          <button type="submit" disabled={busy || form.api_key.length < 8} className={btn.primary}>
            {busy && <Loader2 size={16} className="animate-spin" />}
            {t('connections.saveAndTest')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

const ModelsSection = () => {
  const { t } = useI18n();
  const { codexEnabled } = useAppConfig();
  const ask = useConfirm();
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [options, setOptions] = useState<ModelOption[]>([]);
  const [prefs, setPrefs] = useState<UserModelPrefs | null>(null);
  const [codexOpen, setCodexOpen] = useState(false);
  const [keyOpen, setKeyOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  const load = useCallback(() => {
    Promise.all([connectionsApi.list(), modelsApi.options(), modelsApi.prefs()])
      .then(([info, opts, p]) => {
        setConnections(info.connections.filter((c) => c.kind === 'codex' || c.kind === 'api_key'));
        setOptions(opts);
        setPrefs(p);
      })
      .catch(() => setConnections([]));
  }, []);

  useEffect(load, [load]);

  const codex = connections?.find((c) => c.kind === 'codex');
  const keys = connections?.filter((c) => c.kind === 'api_key') ?? [];
  const hawkModels = options.filter((o) => o.provider === 'studyhawk');

  const savePrefs = async () => {
    if (!prefs) return;
    setSaving(true);
    try {
      setPrefs(await modelsApi.savePrefs(prefs));
      setToast(t('common.saved'));
      setTimeout(() => setToast(''), 2500);
    } finally {
      setSaving(false);
    }
  };

  if (!connections || !prefs)
    return (
      <div className="space-y-6">
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    );

  return (
    <>
      {(codexEnabled || codex) && (
      <Panel
        title={t('models.chatgptTitle')}
        description={t('models.chatgptBody')}
        actions={
          codex ? (
            <StatusBadge connection={codex} />
          ) : (
            <button type="button" onClick={() => setCodexOpen(true)} className={btn.primary}>
              <Sparkles size={16} aria-hidden="true" />
              {t('models.codexConnect')}
            </button>
          )
        }
      >
        <p className="text-xs text-slate-500 dark:text-slate-400">{t('models.chatgptNote')}</p>
        {codex && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span className="text-sm text-slate-700 dark:text-slate-300">{codex.meta.email ?? codex.label}</span>
            <button
              type="button"
              className={btn.secondary}
              onClick={() => ask(() => void connectionsApi.remove(codex.id).then(() => setConnections((prev) => prev?.filter((c) => c.id !== codex.id) ?? null)))}
            >
              <Trash2 size={16} aria-hidden="true" />
              {t('models.disconnect')}
            </button>
          </div>
        )}
      </Panel>
      )}

      <Panel title={t('models.hawkTitle')} description={t('models.hawkBody')}>
        {hawkModels.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('models.hawkNone')}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {hawkModels.map((m) => (
              <li key={m.ref} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700">
                <Server size={15} className="text-slate-400" aria-hidden="true" />
                <span className="font-medium text-slate-800 dark:text-slate-200">{m.label}</span>
                {m.tags.map((tag) => (
                  <Badge key={tag} tone="accent">
                    {tag}
                  </Badge>
                ))}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title={t('models.keysTitle')}
        description={t('models.keysBody')}
        actions={
          <button type="button" onClick={() => setKeyOpen(true)} className={btn.secondary}>
            <Plus size={16} aria-hidden="true" />
            {t('models.addKey')}
          </button>
        }
      >
        {keys.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('models.noKeys')}</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {keys.map((key) => (
              <li key={key.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                <KeyRound size={16} className="text-slate-400" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-slate-800 dark:text-slate-200">{key.label}</span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400">
                    {PROVIDERS.find((p) => p.id === key.provider)?.label ?? key.provider} {key.meta.key_hint && `· ${key.meta.key_hint}`}
                  </span>
                </span>
                <StatusBadge connection={key} />
                <button
                  type="button"
                  onClick={() => ask(() => void connectionsApi.remove(key.id).then(() => setConnections((prev) => prev?.filter((c) => c.id !== key.id) ?? null)))}
                  className={btn.iconDanger}
                  aria-label={t('common.remove')}
                >
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={t('models.defaultTitle')} description={t('models.defaultBody')}>
        <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label={t('models.defaultTitle')}>
          {(['auto', 'manual'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={prefs.mode === mode}
              onClick={() => setPrefs({ ...prefs, mode })}
              className={`flex items-start gap-3 rounded-xl border-2 p-4 text-left transition ${
                prefs.mode === mode ? 'border-[var(--accent-500)] bg-[var(--accent-50)] dark:bg-[var(--accent-500)]/10' : 'border-slate-200 hover:border-slate-300 dark:border-slate-700'
              }`}
            >
              {mode === 'auto' ? <Wand2 size={18} className="mt-0.5 text-[var(--accent-600)]" aria-hidden="true" /> : <Server size={18} className="mt-0.5 text-slate-500" aria-hidden="true" />}
              <span>
                <span className="block font-medium text-slate-900 dark:text-slate-100">{mode === 'auto' ? t('models.auto') : t('models.fixed')}</span>
                <span className="mt-0.5 block text-sm text-slate-500 dark:text-slate-400">{mode === 'auto' ? t('models.autoLong') : t('models.fixedLong')}</span>
              </span>
            </button>
          ))}
        </div>

        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          {prefs.mode === 'manual' ? (
            <Field label={t('models.defaultModel')}>
              {(id) => (
                <select id={id} value={prefs.default_model_ref ?? ''} onChange={(e) => setPrefs({ ...prefs, default_model_ref: e.target.value || null })} className={input}>
                  <option value="">{t('models.pick')}</option>
                  {options.map((o) => (
                    <option key={o.ref} value={o.ref}>
                      {o.label} ({o.source_label})
                    </option>
                  ))}
                </select>
              )}
            </Field>
          ) : (
            TIERS.map((tier) => (
              <Field key={tier.id} label={t(tier.label)} hint={t(tier.hint)}>
                {(id, d) => (
                  <select
                    id={id}
                    aria-describedby={d}
                    value={prefs.auto_map[tier.id] ?? ''}
                    onChange={(e) => setPrefs({ ...prefs, auto_map: { ...prefs.auto_map, [tier.id]: e.target.value || undefined } })}
                    className={input}
                  >
                    <option value="">{t('models.autoDefault')}</option>
                    {options
                      .filter((o) => tier.id !== 'vision' || o.supports_vision)
                      .map((o) => (
                        <option key={o.ref} value={o.ref}>
                          {o.label} ({o.source_label})
                        </option>
                      ))}
                  </select>
                )}
              </Field>
            ))
          )}
        </div>

        <button type="button" onClick={() => void savePrefs()} disabled={saving} className={`${btn.primary} mt-6`}>
          {saving && <Loader2 size={16} className="animate-spin" />}
          {t('common.save')}
        </button>
      </Panel>

      {codexOpen && (
        <CodexConnectModal
          onClose={() => setCodexOpen(false)}
          onConnected={(c) => {
            setCodexOpen(false);
            setConnections((prev) => [...(prev ?? []), c]);
            load();
          }}
        />
      )}
      {keyOpen && (
        <ApiKeyModal
          onClose={() => setKeyOpen(false)}
          onSaved={() => {
            setKeyOpen(false);
            load();
          }}
        />
      )}
      {toast && <Toast message={toast} />}
    </>
  );
};

export default ModelsSection;
