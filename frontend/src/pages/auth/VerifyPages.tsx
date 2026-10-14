import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, CircleAlert, Loader2, MailCheck } from 'lucide-react';
import { authApi } from '../../api/auth';
import { ApiError } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useI18n } from '../../i18n/I18nContext';
import { Field, Notice } from '../../components/ui/kit';
import { AuthShell, PasswordInput, authInput, authLink, authSubmit } from './AuthShell';

const RESEND_COOLDOWN = 60;

/** After sign-up: enter the 6-digit code (or click the emailed link). */
export const CheckEmailPage = () => {
  const { t, language } = useI18n();
  const { setSession } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const expiresAt = (location.state as { expiresAt?: string } | null)?.expiresAt;

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { user } = await authApi.verifyCode(email.trim(), code);
      setSession(user);
      navigate('/chat', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.networkError'));
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setError('');
    try {
      await authApi.resendVerification(email.trim());
      setSent(true);
      setCooldown(RESEND_COOLDOWN);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.networkError'));
    }
  };

  return (
    <AuthShell
      title={t('auth.checkTitle')}
      subtitle={
        <>
          {email ? t('auth.checkBody', { email }) : t('auth.checkBodyNoEmail')}{' '}
          {expiresAt
            ? t('auth.checkExpiresAt', { date: new Date(expiresAt).toLocaleString(language, { dateStyle: 'medium', timeStyle: 'short' }) })
            : t('auth.checkExpires')}
        </>
      }
      footer={
        <Link to="/login" className={authLink}>
          {t('auth.backToLogin')}
        </Link>
      }
    >
      <form onSubmit={(e) => void verify(e)} className="space-y-5">
        {error && (
          <Notice tone="danger" icon={CircleAlert}>
            {error}
          </Notice>
        )}
        {sent && (
          <Notice tone="success" icon={MailCheck}>
            {t('auth.resent')}
          </Notice>
        )}

        {!params.get('email') && (
          <Field label={t('auth.schoolEmail')}>
            {(id) => <input id={id} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={authInput} required />}
          </Field>
        )}

        <Field label={t('auth.code')} hint={t('auth.codeHint')}>
          {(id, d) => (
            <input
              id={id}
              aria-describedby={d}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className={`${authInput} text-center font-mono text-2xl tracking-[0.5em]`}
              required
            />
          )}
        </Field>

        <button type="submit" disabled={busy || code.length !== 6 || !email} className={authSubmit}>
          {busy && <Loader2 size={18} className="animate-spin" aria-hidden="true" />}
          {t('auth.verify')}
        </button>

        <p className="text-center text-sm text-slate-600 dark:text-slate-400">
          {t('auth.noEmail')}{' '}
          <button type="button" onClick={() => void resend()} disabled={cooldown > 0 || !email} className={`${authLink} disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline`}>
            {cooldown > 0 ? t('auth.resendIn', { seconds: cooldown }) : t('auth.resend')}
          </button>
        </p>
      </form>
    </AuthShell>
  );
};

/** Landing page for the emailed link: /verify?token=... */
export const VerifyPage = () => {
  const { t } = useI18n();
  const { setSession } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token');
  const [error, setError] = useState(token ? '' : t('auth.verifyMissing'));
  const started = useRef(false);

  useEffect(() => {
    // StrictMode runs effects twice in dev; the token is single-use.
    if (!token || started.current) return;
    started.current = true;
    authApi
      .verifyToken(token)
      .then(({ user }) => {
        setSession(user);
        navigate('/chat', { replace: true });
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : t('common.networkError')));
  }, [token, setSession, navigate, t]);

  return (
    <AuthShell title={t('auth.verifyingTitle')}>
      {error ? (
        <div className="space-y-5">
          <Notice tone="danger" icon={CircleAlert}>
            {error}
          </Notice>
          <Link to="/check-email" className={authLink}>
            {t('auth.useCode')}
          </Link>
        </div>
      ) : (
        <p className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
          <Loader2 size={18} className="animate-spin" aria-hidden="true" />
          {t('auth.verifying')}
        </p>
      )}
    </AuthShell>
  );
};

export const ForgotPasswordPage = () => {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await authApi.forgotPassword(email.trim());
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.networkError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title={t('auth.forgotTitle')}
      subtitle={t('auth.forgotBody')}
      footer={
        <Link to="/login" className={authLink}>
          {t('auth.backToLogin')}
        </Link>
      }
    >
      {done ? (
        <Notice tone="success" icon={MailCheck}>
          {t('auth.forgotSent')}
        </Notice>
      ) : (
        <form onSubmit={(e) => void submit(e)} className="space-y-5">
          {error && (
            <Notice tone="danger" icon={CircleAlert}>
              {error}
            </Notice>
          )}
          <Field label={t('auth.schoolEmail')}>
            {(id) => <input id={id} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={authInput} required />}
          </Field>
          <button type="submit" disabled={busy || !email} className={authSubmit}>
            {busy && <Loader2 size={18} className="animate-spin" aria-hidden="true" />}
            {t('auth.sendReset')}
          </button>
        </form>
      )}
    </AuthShell>
  );
};

export const ResetPasswordPage = () => {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setError(t('auth.errConfirm'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      await authApi.resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.networkError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title={t('auth.resetTitle')}>
      {done ? (
        <div className="space-y-5">
          <Notice tone="success" icon={CheckCircle2}>
            {t('auth.resetDone')}
          </Notice>
          <Link to="/login" className={authSubmit}>
            {t('landingNav.signIn')}
          </Link>
        </div>
      ) : (
        <form onSubmit={(e) => void submit(e)} className="space-y-5">
          {(error || !token) && (
            <Notice tone="danger" icon={CircleAlert}>
              {error || t('auth.verifyMissing')}
            </Notice>
          )}
          <Field label={t('auth.newPassword')} hint={t('auth.passwordHint', { min: 10 })}>
            {(id, d) => <PasswordInput id={id} aria-describedby={d} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={10} />}
          </Field>
          <Field label={t('auth.confirmPassword')}>
            {(id) => <PasswordInput id={id} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />}
          </Field>
          <button type="submit" disabled={busy || !token || password.length < 10} className={authSubmit}>
            {busy && <Loader2 size={18} className="animate-spin" aria-hidden="true" />}
            {t('auth.saveNewPassword')}
          </button>
        </form>
      )}
    </AuthShell>
  );
};
