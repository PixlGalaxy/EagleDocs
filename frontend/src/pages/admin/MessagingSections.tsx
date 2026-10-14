import { useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2, CircleAlert, KeyRound, Loader2, Megaphone, Send } from 'lucide-react';
import { adminApi, type PushSettings, type SmtpSettings } from '../../api/admin';
import { ApiError } from '../../api/client';
import type { Institution } from '../../api/types';
import { useAuth } from '../../context/AuthContext';
import { useI18n } from '../../i18n/I18nContext';
import Toast from '../../components/ui/Toast';
import { Field, Notice, Panel, Skeleton, Switch } from '../../components/ui/kit';
import { btn, input } from '../../components/ui/styles';
import { PasswordInput } from '../auth/AuthShell';

export const EmailSection = () => {
  const { t } = useI18n();
  const { user } = useAuth();
  const [smtp, setSmtp] = useState<SmtpSettings | null>(null);
  const [testTo, setTestTo] = useState(user?.email ?? '');
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    void adminApi.smtp().then(setSmtp).catch(() => undefined);
  }, []);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!smtp) return;
    setBusy('save');
    setResult(null);
    try {
      setSmtp(await adminApi.saveSmtp(smtp));
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
      await adminApi.testSmtp(testTo);
      setResult({ ok: true, message: t('admin.smtpTestSent', { to: testTo }) });
    } catch (err) {
      setResult({ ok: false, message: err instanceof ApiError ? err.message : t('common.networkError') });
    } finally {
      setBusy(null);
    }
  };

  if (!smtp) return <Skeleton className="h-64 rounded-xl" />;

  return (
    <Panel title={t('admin.smtpTitle')} description={t('admin.smtpBody')}>
      <form onSubmit={(e) => void save(e)} className="grid gap-5 sm:grid-cols-2">
        <Field label={t('admin.smtpHost')}>
          {(id) => <input id={id} value={smtp.host} onChange={(e) => setSmtp({ ...smtp, host: e.target.value })} className={`${input} font-mono`} placeholder="smtp.gmail.com" />}
        </Field>
        <div className="flex items-end gap-4">
          <Field label={t('admin.smtpPort')}>
            {(id) => <input id={id} type="number" value={smtp.port} onChange={(e) => setSmtp({ ...smtp, port: Number(e.target.value) })} className={`${input} w-28 font-mono`} />}
          </Field>
          <label className="mb-2 flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <Switch label="TLS" checked={smtp.secure} onChange={(on) => setSmtp({ ...smtp, secure: on, port: on && smtp.port === 587 ? 465 : smtp.port })} />
            TLS
          </label>
        </div>
        <Field label={t('admin.smtpUser')}>
          {(id) => <input id={id} autoComplete="off" value={smtp.user} onChange={(e) => setSmtp({ ...smtp, user: e.target.value })} className={input} />}
        </Field>
        <Field label={t('admin.smtpPassword')} hint={smtp.password_set ? t('admin.secretSet') : undefined}>
          {(id, d) => <PasswordInput id={id} aria-describedby={d} autoComplete="off" value={smtp.password ?? ''} onChange={(e) => setSmtp({ ...smtp, password: e.target.value })} />}
        </Field>
        <Field label={t('admin.smtpFromName')}>
          {(id) => <input id={id} value={smtp.from_name} onChange={(e) => setSmtp({ ...smtp, from_name: e.target.value })} className={input} placeholder="EagleDocs" />}
        </Field>
        <Field label={t('admin.smtpFromEmail')}>
          {(id) => <input id={id} type="email" value={smtp.from_email} onChange={(e) => setSmtp({ ...smtp, from_email: e.target.value })} className={input} placeholder="no-reply@eagledocs.org" />}
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
          <span className="mx-1 hidden h-8 w-px bg-slate-200 dark:bg-slate-700 sm:block" />
          <label htmlFor="smtp-test" className="sr-only">
            {t('admin.smtpTestTo')}
          </label>
          <input id="smtp-test" type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} className={`${input} max-w-xs`} />
          <button type="button" onClick={() => void test()} disabled={busy !== null || !testTo} className={btn.secondary}>
            {busy === 'test' ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} aria-hidden="true" />}
            {t('admin.smtpTest')}
          </button>
        </div>
      </form>
    </Panel>
  );
};

export const PushAdminSection = () => {
  const { t } = useI18n();
  const [push, setPush] = useState<PushSettings | null>(null);
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [msg, setMsg] = useState({ title: '', body: '', url: '', institution_id: '' });
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    void adminApi.push().then(setPush).catch(() => undefined);
    void adminApi.institutions().then(setInstitutions).catch(() => undefined);
  }, []);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    setSending(true);
    setError('');
    try {
      const { sent } = await adminApi.broadcast({ ...msg, institution_id: msg.institution_id || null });
      setToast(t('admin.broadcastSent', { count: sent }));
      setTimeout(() => setToast(''), 3000);
      setMsg({ title: '', body: '', url: '', institution_id: '' });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.networkError'));
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <Panel
        title={t('admin.pushTitle')}
        description={t('admin.pushBody')}
        actions={
          <button type="button" onClick={() => void adminApi.regenerateVapid().then(setPush)} className={btn.secondary}>
            <KeyRound size={16} aria-hidden="true" />
            {t('admin.regenerateVapid')}
          </button>
        }
      >
        {!push ? (
          <Skeleton className="h-20" />
        ) : (
          <div className="space-y-4">
            <dl className="grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-slate-500">{t('admin.subscriptions')}</dt>
                <dd className="font-mono text-2xl font-semibold text-slate-900 dark:text-white">{push.subscriptions}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs text-slate-500">{t('admin.vapidKey')}</dt>
                <dd className="truncate font-mono text-xs text-slate-700 dark:text-slate-300">{push.vapid_public_key ?? '-'}</dd>
              </div>
            </dl>
            <div className="flex max-w-md items-end gap-2">
              <Field label={t('admin.pushContact')} hint={t('admin.pushContactHint')}>
                {(id, d) => <input id={id} aria-describedby={d} type="email" value={push.contact_email} onChange={(e) => setPush({ ...push, contact_email: e.target.value })} className={input} />}
              </Field>
              <button type="button" onClick={() => void adminApi.savePush({ contact_email: push.contact_email }).then(setPush)} className={btn.secondary}>
                {t('common.save')}
              </button>
            </div>
          </div>
        )}
      </Panel>

      <Panel title={t('admin.broadcastTitle')} description={t('admin.broadcastBody')}>
        <form onSubmit={(e) => void send(e)} className="grid gap-5 sm:grid-cols-2">
          <Field label={t('admin.broadcastHeading')}>
            {(id) => <input id={id} value={msg.title} onChange={(e) => setMsg({ ...msg, title: e.target.value })} className={input} required maxLength={80} />}
          </Field>
          <Field label={t('admin.broadcastAudience')}>
            {(id) => (
              <select id={id} value={msg.institution_id} onChange={(e) => setMsg({ ...msg, institution_id: e.target.value })} className={input}>
                <option value="">{t('admin.everyone')}</option>
                {institutions.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <div className="sm:col-span-2">
            <Field label={t('admin.broadcastMessage')}>
              {(id) => <textarea id={id} rows={3} value={msg.body} onChange={(e) => setMsg({ ...msg, body: e.target.value })} className={input} required maxLength={300} />}
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label={t('admin.broadcastUrl')}>
              {(id) => <input id={id} type="url" value={msg.url} onChange={(e) => setMsg({ ...msg, url: e.target.value })} className={input} placeholder="https://" />}
            </Field>
          </div>
          {error && (
            <div className="sm:col-span-2">
              <Notice tone="danger" icon={CircleAlert}>
                {error}
              </Notice>
            </div>
          )}
          <div className="sm:col-span-2">
            <button type="submit" disabled={sending} className={btn.primary}>
              {sending ? <Loader2 size={16} className="animate-spin" /> : <Megaphone size={16} aria-hidden="true" />}
              {t('admin.broadcastSend')}
            </button>
          </div>
        </form>
      </Panel>
      {toast && <Toast message={toast} />}
    </>
  );
};
