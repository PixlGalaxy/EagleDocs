import { useEffect, useState } from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { CircleAlert, Loader2, ShieldCheck, TriangleAlert } from 'lucide-react';
import { mcpApi } from '../../api/account';
import { ApiError } from '../../api/client';
import type { McpScope, OAuthConsent } from '../../api/types';
import { useAuth } from '../../context/AuthContext';
import { useI18n } from '../../i18n/I18nContext';
import { Notice } from '../../components/ui/kit';
import { btn } from '../../components/ui/styles';
import { SCOPE_LABEL } from '../settings/AppsSection';
import { AuthShell } from './AuthShell';
import BrandLoader from '../../components/ui/BrandLoader';

/** Where the well-known MCP clients send the code back. Any other app is shown as unverified, with its address. */
const KNOWN_APP_HOSTS = ['chatgpt.com', 'chat.openai.com', 'openai.com', 'claude.ai', 'claude.com', 'anthropic.com', 'localhost', '127.0.0.1'];

const SCOPE_HINT: Record<McpScope, 'apps.scopeCanvasHint' | 'apps.scopeDegreeworksHint' | 'apps.scopeWorkspaceHint' | 'apps.scopeMemoryHint'> = {
  'canvas.read': 'apps.scopeCanvasHint',
  'degreeworks.read': 'apps.scopeDegreeworksHint',
  workspace: 'apps.scopeWorkspaceHint',
  memory: 'apps.scopeMemoryHint',
};

/**
 * OAuth consent for MCP clients. The backend's /oauth/authorize validates the
 * client and PKCE, stores the request and redirects here with ?request=<id>.
 */
const ConsentPage = () => {
  const { user, isLoading } = useAuth();
  const { t } = useI18n();
  const location = useLocation();
  const [params] = useSearchParams();
  const requestId = params.get('request') ?? '';
  const [consent, setConsent] = useState<OAuthConsent | null>(null);
  const [granted, setGranted] = useState<McpScope[]>([]);
  const [error, setError] = useState(requestId ? '' : t('auth.verifyMissing'));
  const [busy, setBusy] = useState<'approve' | 'deny' | null>(null);

  useEffect(() => {
    if (!user || !requestId) return;
    mcpApi
      .consent(requestId)
      .then((c) => {
        setConsent(c);
        setGranted(c.scopes);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : t('common.networkError')));
  }, [user, requestId, t]);

  if (isLoading) return null;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;

  const decide = async (approve: boolean) => {
    setBusy(approve ? 'approve' : 'deny');
    try {
      const { redirect_to } = await mcpApi.decide(requestId, approve, granted);
      window.location.href = redirect_to;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.networkError'));
      setBusy(null);
    }
  };

  const toggle = (scope: McpScope) => setGranted((prev) => (prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]));

  // Anyone can register an app with any name ("ChatGPT"): where the access goes is what counts.
  const redirectHost = consent && URL.canParse(consent.redirect_uri) ? new URL(consent.redirect_uri).hostname.toLowerCase() : '';
  const verified = KNOWN_APP_HOSTS.some((h) => redirectHost === h || redirectHost.endsWith(`.${h}`));
  const shownName = consent ? (verified ? consent.client_name : `${consent.client_name} (${redirectHost})`) : '';

  return (
    <AuthShell
      title={consent ? t('apps.consentTitle', { name: shownName }) : t('apps.consentLoading')}
      subtitle={consent ? t('apps.consentBody', { email: user.email }) : undefined}
    >
      {error ? (
        <Notice tone="danger" icon={CircleAlert}>
          {error}
        </Notice>
      ) : !consent ? (
        <p className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
          <BrandLoader size={24} />
          {t('auth.verifying')}
        </p>
      ) : (
        <div className="space-y-6">
          {!verified && (
            <Notice tone="warning" icon={TriangleAlert}>
              {t('apps.consentUnverified', { host: redirectHost })}
            </Notice>
          )}
          <fieldset>
            <legend className="text-sm font-medium text-slate-700 dark:text-slate-300">{t('apps.consentScopes')}</legend>
            <ul className="mt-3 space-y-2">
              {consent.scopes.map((scope) => (
                <li key={scope}>
                  <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                    <input
                      type="checkbox"
                      checked={granted.includes(scope)}
                      onChange={() => toggle(scope)}
                      className="mt-0.5 h-4 w-4 accent-[var(--accent-600)]"
                    />
                    <span>
                      <span className="block text-sm font-medium text-slate-900 dark:text-slate-100">{t(SCOPE_LABEL[scope])}</span>
                      <span className="block text-xs text-slate-500 dark:text-slate-400">{t(SCOPE_HINT[scope])}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>

          <Notice tone="neutral" icon={ShieldCheck}>
            {t('apps.consentNote')}
            <span className="mt-1 block break-all font-mono text-xs text-slate-500">{consent.redirect_uri}</span>
          </Notice>

          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => void decide(false)} disabled={busy !== null} className={btn.secondary}>
              {busy === 'deny' && <Loader2 size={16} className="animate-spin" />}
              {t('apps.deny')}
            </button>
            <button type="button" onClick={() => void decide(true)} disabled={busy !== null || granted.length === 0} className={btn.primary}>
              {busy === 'approve' && <Loader2 size={16} className="animate-spin" />}
              {t('apps.allow')}
            </button>
          </div>
        </div>
      )}
    </AuthShell>
  );
};

export default ConsentPage;
