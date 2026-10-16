import { useState, type FormEvent } from 'react';
import { CheckCircle2, CircleAlert, Loader2 } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';
import PublicLayout from '../../components/layout/PublicLayout';
import { Field, Notice } from '../../components/ui/kit';
import { btn, input } from '../../components/ui/styles';
import { DISCORD_URL, GITHUB_URL, SUPPORT_EMAIL } from '../../components/brand';
import { useAppConfig } from '../../context/AppConfigContext';
import { ApiError } from '../../api/client';
import { contactApi } from '../../api/contact';

const EMPTY = { name: '', email: '', message: '', website: '' };

const ContactPage = () => {
  const { t } = useI18n();
  const { statusPageUrl: statusUrl } = useAppConfig();
  const [form, setForm] = useState(EMPTY);
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (status === 'sending') return;
    setStatus('sending');
    setError('');
    try {
      await contactApi.send(form);
      setStatus('sent');
      setForm(EMPTY);
    } catch (err) {
      // The server's own words (too short, too many messages, not set up), else the generic line.
      setError(err instanceof ApiError && err.status !== 500 ? err.message : t('contact.failed'));
      setStatus('error');
    }
  };

  return (
    <PublicLayout title={t('footer.contact')}>
      <section className="mx-auto grid max-w-6xl gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div>
          <h1 className="text-4xl font-semibold tracking-tight text-slate-950 dark:text-white md:text-5xl">{t('contact.title')}</h1>
          <p className="mt-4 max-w-[45ch] text-lg text-slate-600 dark:text-slate-300">{t('contact.body')}</p>
          <dl className="mt-10 space-y-6 text-sm">
            <div>
              <dt className="text-slate-500 dark:text-slate-400">Email</dt>
              <dd className="mt-1">
                <a href={`mailto:${SUPPORT_EMAIL}`} className="font-medium text-[var(--accent-700)] hover:underline dark:text-[var(--accent-300)]">
                  {SUPPORT_EMAIL}
                </a>
              </dd>
            </div>
            <div>
              <dt className="text-slate-500 dark:text-slate-400">{t('contact.elsewhere')}</dt>
              <dd className="mt-1 flex flex-wrap gap-x-5 gap-y-2 font-medium">
                <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="text-slate-700 hover:text-slate-950 dark:text-slate-300 dark:hover:text-white">
                  GitHub
                </a>
                <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer" className="text-slate-700 hover:text-slate-950 dark:text-slate-300 dark:hover:text-white">
                  Discord
                </a>
                {statusUrl && (
                  <a href={statusUrl} target="_blank" rel="noopener noreferrer" className="text-slate-700 hover:text-slate-950 dark:text-slate-300 dark:hover:text-white">
                    {t('landingNav.status')}
                  </a>
                )}
              </dd>
            </div>
          </dl>
        </div>

        <form onSubmit={(e) => void submit(e)} className="relative space-y-5 rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 sm:p-8">
          {status === 'sent' && (
            <Notice tone="success" icon={CheckCircle2}>
              {t('contact.sent')}
            </Notice>
          )}
          {status === 'error' && (
            <Notice tone="danger" icon={CircleAlert}>
              {error || t('contact.failed')}
            </Notice>
          )}
          <Field label={t('contact.name')}>
            {(id) => <input id={id} autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={input} required maxLength={100} />}
          </Field>
          <Field label="Email">
            {(id) => <input id={id} type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={input} required maxLength={254} />}
          </Field>
          <Field label={t('contact.message')}>
            {(id) => <textarea id={id} rows={6} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} className={input} required minLength={10} maxLength={5000} />}
          </Field>
          {/* Honeypot: off-screen and hidden from screen readers and the keyboard; only bots fill it. */}
          <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
            <input type="text" name="website" tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
          </div>
          <button type="submit" disabled={status === 'sending'} className={`${btn.primary} w-full py-2.5`}>
            {status === 'sending' && <Loader2 size={16} className="animate-spin" />}
            {t('contact.send')}
          </button>
        </form>
      </section>
    </PublicLayout>
  );
};

export default ContactPage;
