import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CircleAlert, Loader2, MailWarning } from 'lucide-react';
import { authApi } from '../../api/auth';
import { ApiError } from '../../api/client';
import { useAppConfig } from '../../context/AppConfigContext';
import { useI18n } from '../../i18n/I18nContext';
import { Field, Notice } from '../../components/ui/kit';
import { AuthShell, PasswordInput, authInput, authLink, authSubmit } from './AuthShell';

const USERNAME = /^[a-zA-Z0-9_.-]{3,32}$/;
const MIN_PASSWORD = 10;

function domainAllowed(email: string, domains: string[]): boolean {
  const domain = email.split('@')[1]?.toLowerCase().trim();
  if (!domain) return false;
  return domains.some((allowed) => domain === allowed || domain.endsWith(`.${allowed}`));
}

const RegisterPage = () => {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { institutions, registrationEnabled, emailConfigured, loaded } = useAppConfig();
  const [form, setForm] = useState({ displayName: '', username: '', email: '', password: '', confirm: '' });
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const domains = useMemo(() => institutions.flatMap((i) => i.domains), [institutions]);

  // Client-side checks mirror the server's so most mistakes show before submitting.
  const errors = {
    displayName: !form.displayName.trim() ? t('auth.errRequired') : null,
    username: !USERNAME.test(form.username) ? t('auth.errUsername') : null,
    email: !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email)
      ? t('auth.errEmail')
      : domains.length && !domainAllowed(form.email, domains)
        ? t('auth.errDomain')
        : null,
    password: form.password.length < MIN_PASSWORD ? t('auth.errPassword', { min: MIN_PASSWORD }) : null,
    confirm: form.confirm !== form.password ? t('auth.errConfirm') : null,
  };
  const valid = Object.values(errors).every((e) => e === null);
  const show = (key: keyof typeof errors) => (touched ? errors[key] : null);
  const closed = loaded && (!registrationEnabled || !emailConfigured);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!valid) return;
    setError('');
    setSubmitting(true);
    try {
      const result = await authApi.register({
        email: form.email.trim(),
        username: form.username.trim(),
        displayName: form.displayName.trim(),
        password: form.password,
      });
      navigate(`/check-email?email=${encodeURIComponent(result.email)}`, { state: { expiresAt: result.expires_at } });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.networkError'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      title={t('auth.registerTitle')}
      subtitle={t('auth.registerSubtitle')}
      footer={
        <>
          {t('auth.haveAccount')}{' '}
          <Link to="/login" className={authLink}>
            {t('landingNav.signIn')}
          </Link>
        </>
      }
    >
      {closed ? (
        <Notice tone="warning" icon={MailWarning}>
          {!registrationEnabled ? t('auth.registrationClosed') : t('auth.registrationNoEmail')}
        </Notice>
      ) : (
        <form onSubmit={(e) => void submit(e)} className="space-y-5" noValidate>
          {error && (
            <Notice tone="danger" icon={CircleAlert}>
              {error}
            </Notice>
          )}

          <Field label={t('auth.displayName')} error={show('displayName')}>
            {(id, d) => <input id={id} aria-describedby={d} aria-invalid={!!show('displayName')} autoComplete="name" value={form.displayName} onChange={set('displayName')} className={authInput} />}
          </Field>

          <Field label={t('auth.username')} hint={t('auth.usernameHint')} error={show('username')}>
            {(id, d) => (
              <input id={id} aria-describedby={d} aria-invalid={!!show('username')} autoComplete="username" spellCheck={false} value={form.username} onChange={set('username')} className={authInput} />
            )}
          </Field>

          <Field
            label={t('auth.schoolEmail')}
            hint={domains.length ? t('auth.allowedDomains', { domains: domains.join(', ') }) : t('auth.schoolEmailHint')}
            error={show('email')}
          >
            {(id, d) => (
              <input id={id} type="email" aria-describedby={d} aria-invalid={!!show('email')} autoComplete="email" spellCheck={false} value={form.email} onChange={set('email')} className={authInput} />
            )}
          </Field>

          <Field label={t('auth.password')} hint={t('auth.passwordHint', { min: MIN_PASSWORD })} error={show('password')}>
            {(id, d) => <PasswordInput id={id} aria-describedby={d} aria-invalid={!!show('password')} autoComplete="new-password" value={form.password} onChange={set('password')} />}
          </Field>

          <Field label={t('auth.confirmPassword')} error={show('confirm')}>
            {(id, d) => <PasswordInput id={id} aria-describedby={d} aria-invalid={!!show('confirm')} autoComplete="new-password" value={form.confirm} onChange={set('confirm')} />}
          </Field>

          <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            {t('auth.terms')}{' '}
            <Link to="/tos" className={authLink}>
              {t('footer.terms')}
            </Link>{' '}
            ·{' '}
            <Link to="/privacy" className={authLink}>
              {t('footer.privacy')}
            </Link>
          </p>

          <button type="submit" disabled={submitting} className={authSubmit}>
            {submitting && <Loader2 size={18} className="animate-spin" aria-hidden="true" />}
            {submitting ? t('auth.creating') : t('auth.createAccount')}
          </button>
        </form>
      )}
    </AuthShell>
  );
};

export default RegisterPage;
