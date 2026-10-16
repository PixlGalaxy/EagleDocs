import { useState, type FormEvent } from 'react';
import { CheckCircle2, CircleAlert, Loader2 } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';
import PublicLayout from '../../components/layout/PublicLayout';
import { Field, Notice } from '../../components/ui/kit';
import { btn, input } from '../../components/ui/styles';
import { STATUS_URL, SUPPORT_EMAIL } from '../../components/brand';

const ContactPage = () => {
  const { t } = useI18n();
  const [form, setForm] = useState({ name: '', email: '', message: '' });
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setStatus('sending');
    try {
      const res = await fetch('https://contact.eagledocs.org/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error();
      setStatus('sent');
      setForm({ name: '', email: '', message: '' });
    } catch {
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
                <a href="https://github.com/PixlGalaxy/StudyHawk" target="_blank" rel="noopener noreferrer" className="text-slate-700 hover:text-slate-950 dark:text-slate-300 dark:hover:text-white">
                  GitHub
                </a>
                <a href="https://discord.gg/4RuUjT2jNv" target="_blank" rel="noopener noreferrer" className="text-slate-700 hover:text-slate-950 dark:text-slate-300 dark:hover:text-white">
                  Discord
                </a>
                <a href={STATUS_URL} target="_blank" rel="noopener noreferrer" className="text-slate-700 hover:text-slate-950 dark:text-slate-300 dark:hover:text-white">
                  {t('landingNav.status')}
                </a>
              </dd>
            </div>
          </dl>
        </div>

        <form onSubmit={(e) => void submit(e)} className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 sm:p-8">
          {status === 'sent' && (
            <Notice tone="success" icon={CheckCircle2}>
              {t('contact.sent')}
            </Notice>
          )}
          {status === 'error' && (
            <Notice tone="danger" icon={CircleAlert}>
              {t('contact.failed')}
            </Notice>
          )}
          <Field label={t('contact.name')}>
            {(id) => <input id={id} autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={input} required />}
          </Field>
          <Field label="Email">
            {(id) => <input id={id} type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={input} required />}
          </Field>
          <Field label={t('contact.message')}>
            {(id) => <textarea id={id} rows={6} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} className={input} required />}
          </Field>
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
