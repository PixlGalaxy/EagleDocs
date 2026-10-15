import { useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2, CircleAlert, Loader2, Search } from 'lucide-react';
import { adminApi, type WebSearchSettings } from '../../api/admin';
import { ApiError } from '../../api/client';
import { useI18n } from '../../i18n/I18nContext';
import { Field, Notice, Panel, Skeleton } from '../../components/ui/kit';
import { btn, input } from '../../components/ui/styles';
import { PasswordInput } from '../auth/AuthShell';

/** The free searches always run first; a paid API joins after them only with a key. */
const WebSearchSection = () => {
  const { t } = useI18n();
  const [settings, setSettings] = useState<WebSearchSettings | null>(null);
  const [provider, setProvider] = useState('none');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    void adminApi
      .webSearch()
      .then((s) => {
        setSettings(s);
        setProvider(s.paid_provider);
      })
      .catch(() => undefined);
  }, []);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('save');
    setResult(null);
    try {
      // The key is write-only: sent only when typed, so saving the provider alone keeps the stored one.
      const saved = await adminApi.saveWebSearch({ paid_provider: provider, ...(apiKey && { api_key: apiKey }) });
      setSettings(saved);
      setApiKey('');
      setResult({ ok: true, message: t('common.saved') });
    } catch (err) {
      setResult({ ok: false, message: err instanceof ApiError ? err.message : t('common.networkError') });
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    setBusy('test');
    setResult(null);
    try {
      const r = await adminApi.testWebSearch();
      setResult(r.ok ? { ok: true, message: t('admin.webSearchTestOk', { count: r.results ?? 0 }) } : { ok: false, message: t('admin.webSearchTestFailed', { error: r.error ?? '' }) });
    } catch (err) {
      setResult({ ok: false, message: err instanceof ApiError ? err.message : t('common.networkError') });
    } finally {
      setBusy(null);
    }
  };

  if (!settings) return <Skeleton className="h-64 rounded-xl" />;
  const saved = settings.paid_provider !== 'none' && settings.api_key_set;

  return (
    <Panel title={t('admin.webSearchTitle')} description={t('admin.webSearchBody')}>
      <form onSubmit={(e) => void save(e)} className="grid gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Notice tone="neutral" icon={Search}>
            {settings.searxng ? t('admin.webSearchOrderSearx') : t('admin.webSearchOrder')}
          </Notice>
        </div>
        <Field label={t('admin.webSearchPaid')}>
          {(id) => (
            <select id={id} value={provider} onChange={(e) => setProvider(e.target.value)} className={input}>
              <option value="none">{t('admin.webSearchNone')}</option>
              <option value="brave">Brave Search API</option>
              <option value="tavily">Tavily</option>
            </select>
          )}
        </Field>
        <Field label={t('admin.webSearchKey')} hint={settings.api_key_set ? t('admin.secretSet') : undefined}>
          {(id, d) => (
            <PasswordInput id={id} aria-describedby={d} autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} disabled={provider === 'none'} maxLength={300} />
          )}
        </Field>
        {result && (
          <div className="sm:col-span-2">
            <Notice tone={result.ok ? 'success' : 'danger'} icon={result.ok ? CheckCircle2 : CircleAlert}>
              {result.message}
            </Notice>
          </div>
        )}
        <div className="flex flex-wrap items-end gap-3 sm:col-span-2">
          <button type="submit" disabled={busy !== null} className={btn.primary}>
            {busy === 'save' && <Loader2 size={16} className="animate-spin" />}
            {t('common.save')}
          </button>
          <button type="button" onClick={() => void test()} disabled={busy !== null || !saved} className={btn.secondary}>
            {busy === 'test' ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} aria-hidden="true" />}
            {t('admin.webSearchTest')}
          </button>
        </div>
      </form>
    </Panel>
  );
};

export default WebSearchSection;
