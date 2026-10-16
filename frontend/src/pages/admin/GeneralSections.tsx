import { useEffect, useState } from 'react';
import { CheckCircle2, CircleAlert, Loader2, Send, Trash2 } from 'lucide-react';
import { adminApi, type GeneralSettings } from '../../api/admin';
import { ApiError } from '../../api/client';
import { useI18n } from '../../i18n/I18nContext';
import { LANGUAGE_NAMES, SUPPORTED_LANGUAGES } from '../../i18n/translations';
import { isSkinId, isThemeMode, type SkinId, type ThemeMode } from '../../theme/themes';
import ThemePicker from '../../components/ThemePicker';
import Toast from '../../components/ui/Toast';
import { Field, Notice, Panel, Skeleton, Switch } from '../../components/ui/kit';
import { btn, input } from '../../components/ui/styles';
import { PasswordInput } from '../auth/AuthShell';

/** Under the beta switch: the Discord channel the testers' BetaTest Bug Report button posts to. */
const BetaReportWebhook = () => {
  const { t } = useI18n();
  const [set, setSet] = useState<boolean | null>(null);
  const [webhook, setWebhook] = useState('');
  const [busy, setBusy] = useState<'save' | 'clear' | 'test' | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    void adminApi
      .betaReport()
      .then((r) => setSet(r.discord_webhook_set))
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : t('common.networkError')));
  }, [t]);

  const run = async (kind: 'save' | 'clear' | 'test') => {
    setBusy(kind);
    setResult(null);
    try {
      if (kind === 'test') {
        const r = await adminApi.testBetaReport();
        setResult(r.ok ? { ok: true, message: t('admin.betaWebhookSent') } : { ok: false, message: t('admin.betaWebhookFailed', { error: r.error ?? '?' }) });
      } else {
        setSet((await adminApi.saveBetaReport(kind === 'save' ? webhook.trim() : '')).discord_webhook_set);
        setWebhook('');
        setResult({ ok: true, message: t('common.saved') });
      }
    } catch (err) {
      setResult({ ok: false, message: err instanceof ApiError ? err.message : t('common.networkError') });
    } finally {
      setBusy(null);
    }
  };

  if (loadError)
    return (
      <Notice tone="danger" icon={CircleAlert}>
        {t('admin.betaWebhookLoadFailed', { error: loadError })}
      </Notice>
    );
  if (set === null) return <Skeleton className="h-20 rounded-xl" />;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (webhook.trim()) void run('save');
      }}
      className="space-y-4 border-t border-slate-200 pt-5 dark:border-slate-800"
    >
      <Field label={t('admin.betaWebhook')} hint={set ? t('admin.betaWebhookSet') : t('admin.betaWebhookHint')}>
        {(id, d) => (
          <div className="flex gap-2">
            <div className="min-w-0 flex-1">
              <PasswordInput id={id} aria-describedby={d} autoComplete="off" value={webhook} onChange={(e) => setWebhook(e.target.value)} placeholder="https://discord.com/api/webhooks/..." maxLength={500} />
            </div>
            {set && (
              <button type="button" onClick={() => void run('clear')} disabled={busy !== null} className={btn.secondary} aria-label={t('common.remove')} title={t('common.remove')}>
                {busy === 'clear' ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} aria-hidden="true" />}
              </button>
            )}
          </div>
        )}
      </Field>
      {result && (
        <Notice tone={result.ok ? 'success' : 'danger'} icon={result.ok ? CheckCircle2 : CircleAlert}>
          {result.message}
        </Notice>
      )}
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={busy !== null || !webhook.trim()} className={btn.primary}>
          {busy === 'save' && <Loader2 size={16} className="animate-spin" />}
          {t('common.save')}
        </button>
        <button type="button" onClick={() => void run('test')} disabled={busy !== null || !set} className={btn.secondary}>
          {busy === 'test' ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} aria-hidden="true" />}
          {t('admin.betaWebhookTest')}
        </button>
      </div>
    </form>
  );
};

export const GeneralSection = () => {
  const { t } = useI18n();
  const [s, setS] = useState<GeneralSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => {
    void adminApi.general().then(setS).catch(() => undefined);
  }, []);

  const save = async (patch?: Partial<GeneralSettings>) => {
    if (!s) return;
    setSaving(true);
    try {
      setS(await adminApi.saveGeneral(patch ?? s));
      setToast(t('common.saved'));
      setTimeout(() => setToast(''), 2500);
    } finally {
      setSaving(false);
    }
  };

  if (!s) return <Skeleton className="h-64 rounded-xl" />;

  return (
    <>
      <Panel
        title={t('admin.registrationTitle')}
        description={t('admin.registrationBody')}
        actions={
          <Switch
            label={t('admin.registrationTitle')}
            checked={s.registration_enabled}
            onChange={(on) => {
              setS({ ...s, registration_enabled: on });
              void save({ registration_enabled: on });
            }}
          />
        }
      />

      <Panel
        title={t('admin.betaTitle')}
        description={t('admin.betaBody')}
        actions={
          <Switch
            label={t('admin.betaTitle')}
            checked={s.beta_test}
            onChange={(on) => {
              setS({ ...s, beta_test: on });
              void save({ beta_test: on });
            }}
          />
        }
      >
        {s.beta_test && <BetaReportWebhook />}
      </Panel>

      <Panel
        title={t('admin.mcpTitle')}
        description={t('admin.mcpBody')}
        actions={
          <Switch
            label={t('admin.mcpTitle')}
            checked={s.mcp_enabled}
            onChange={(on) => {
              setS({ ...s, mcp_enabled: on });
              void save({ mcp_enabled: on });
            }}
          />
        }
      />

      <Panel title={t('admin.generalTitle')} description={t('admin.generalBody')}>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={t('admin.defaultLanguage')}>
            {(id) => (
              <select id={id} value={s.default_language} onChange={(e) => setS({ ...s, default_language: e.target.value })} className={input}>
                {SUPPORTED_LANGUAGES.map((code) => (
                  <option key={code} value={code}>
                    {LANGUAGE_NAMES[code]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label={t('admin.sessionTtl')} hint={t('admin.sessionTtlHint')}>
            {(id, d) => <input id={id} aria-describedby={d} type="number" min={1} value={s.session_ttl_hours} onChange={(e) => setS({ ...s, session_ttl_hours: Number(e.target.value) })} className={`${input} font-mono`} />}
          </Field>
          <div className="sm:col-span-2">
            <Field label={t('admin.statusPageUrl')} hint={t('admin.statusPageUrlHint')}>
              {(id, d) => <input id={id} aria-describedby={d} type="url" value={s.status_page_url} onChange={(e) => setS({ ...s, status_page_url: e.target.value })} className={`${input} font-mono`} placeholder="https://status.example.com" />}
            </Field>
          </div>
        </div>
        <button type="button" onClick={() => void save()} disabled={saving} className={`${btn.primary} mt-6`}>
          {saving && <Loader2 size={16} className="animate-spin" />}
          {t('common.save')}
        </button>
      </Panel>

      <Panel title={t('admin.defaultAppearance')} description={t('admin.defaultAppearanceBody')}>
        <ThemePicker
          mode={isThemeMode(s.default_theme_mode) ? s.default_theme_mode : 'system'}
          skin={isSkinId(s.default_theme_skin) ? s.default_theme_skin : 'hawk'}
          onModeChange={(mode: ThemeMode) => void save({ default_theme_mode: mode })}
          onSkinChange={(skin: SkinId) => void save({ default_theme_skin: skin })}
        />
      </Panel>
      {toast && <Toast message={toast} />}
    </>
  );
};
