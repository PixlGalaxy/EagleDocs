import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { CircleAlert, CircleCheck, Loader2, MailCheck } from 'lucide-react';
import { ApiError } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useI18n } from '../../i18n/I18nContext';
import { Field, Notice } from '../../components/ui/kit';
import { AuthShell, PasswordInput, authInput, authLink, authSubmit } from './AuthShell';

const LoginPage = () => {
  const { login } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const [identity, setIdentity] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [unverified, setUnverified] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  /** Where to go once the student has read that their account was restored. */
  const [restoredTo, setRestoredTo] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setUnverified(false);
    setSubmitting(true);
    try {
      const { restored } = await login(identity.trim(), password);
      const from = (location.state as { from?: string } | null)?.from;
      const to = from && from !== '/login' ? from : '/chat';
      if (restored) setRestoredTo(to);
      else navigate(to, { replace: true });
    } catch (err) {
      // 403 = the account exists but its email is not verified yet.
      if (err instanceof ApiError && err.status === 403) setUnverified(true);
      else setError(err instanceof ApiError ? err.message : t('common.networkError'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      title={t('auth.loginTitle')}
      subtitle={t('auth.loginSubtitle')}
      footer={
        <>
          {t('auth.noAccount')}{' '}
          <Link to="/register" className={authLink}>
            {t('landingNav.getStarted')}
          </Link>
        </>
      }
    >
      {restoredTo ? (
        <div className="space-y-5">
          <Notice tone="success" icon={CircleCheck}>
            {t('auth.accountRestored')}
          </Notice>
          <button type="button" onClick={() => navigate(restoredTo, { replace: true })} className={authSubmit}>
            {t('auth.continue')}
          </button>
        </div>
      ) : (
      <form onSubmit={(e) => void submit(e)} className="space-y-5" noValidate>
        {error && (
          <Notice tone="danger" icon={CircleAlert}>
            {error}
          </Notice>
        )}
        {unverified && (
          <Notice tone="warning" icon={MailCheck}>
            {t('auth.unverified')}{' '}
            <Link to={`/check-email?email=${encodeURIComponent(identity.includes('@') ? identity.trim() : '')}`} className="font-medium underline underline-offset-2">
              {t('auth.unverifiedLink')}
            </Link>
          </Notice>
        )}

        <Field label={t('auth.identity')}>
          {(id, describedBy) => (
            <input
              id={id}
              aria-describedby={describedBy}
              autoComplete="username"
              maxLength={254}
              value={identity}
              onChange={(e) => setIdentity(e.target.value)}
              className={authInput}
              required
              disabled={submitting}
            />
          )}
        </Field>

        <div>
          <Field label={t('auth.password')}>
            {(id) => (
              <PasswordInput id={id} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required disabled={submitting} />
            )}
          </Field>
          <div className="mt-2 text-right">
            <Link to="/forgot-password" className={`text-sm ${authLink}`}>
              {t('auth.forgot')}
            </Link>
          </div>
        </div>

        <button type="submit" disabled={submitting || !identity || !password} className={authSubmit}>
          {submitting && <Loader2 size={18} className="animate-spin" aria-hidden="true" />}
          {submitting ? t('auth.signingIn') : t('landingNav.signIn')}
        </button>
      </form>
      )}
    </AuthShell>
  );
};

export default LoginPage;
