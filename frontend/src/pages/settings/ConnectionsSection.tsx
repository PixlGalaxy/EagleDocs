import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { BookOpen, CircleAlert, ExternalLink, GraduationCap, Loader2, Lock, Mail, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { connectionsApi } from '../../api/account';
import { ApiError } from '../../api/client';
import type { Connection, ConnectionsInfo } from '../../api/types';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../components/ui/confirm';
import { useI18n } from '../../i18n/I18nContext';
import { Badge, Field, Notice, Panel, Skeleton, Switch } from '../../components/ui/kit';
import { btn, input } from '../../components/ui/styles';
import { PasswordInput } from '../auth/AuthShell';

export function StatusBadge({ connection }: { connection: Connection | undefined }) {
  const { t, language } = useI18n();
  if (!connection) return <Badge>{t('connections.notConnected')}</Badge>;
  if (connection.status === 'ok')
    return (
      <Badge tone="success">
        {t('connections.connected')}
        {connection.last_ok_at && ` · ${new Date(connection.last_ok_at).toLocaleDateString(language, { month: 'short', day: 'numeric' })}`}
      </Badge>
    );
  if (connection.status === 'waiting_mfa') return <Badge tone="warning">{t('connections.waitingMfa')}</Badge>;
  if (connection.status === 'error') return <Badge tone="danger">{t('connections.error')}</Badge>;
  return <Badge tone="accent">{t('connections.untested')}</Badge>;
}

function ConnectionActions({ connection, onChange, onRemoved }: { connection: Connection; onChange: (c: Connection) => void; onRemoved: () => void }) {
  const { t } = useI18n();
  const ask = useConfirm();
  const [busy, setBusy] = useState<'test' | 'remove' | null>(null);
  return (
    <>
      <button
        type="button"
        className={btn.secondary}
        disabled={busy !== null}
        onClick={() => {
          setBusy('test');
          connectionsApi
            .test(connection.id)
            .then(onChange)
            .finally(() => setBusy(null));
        }}
      >
        {busy === 'test' ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} aria-hidden="true" />}
        {t('connections.test')}
      </button>
      <button
        type="button"
        className={btn.secondary}
        disabled={busy !== null}
        onClick={() =>
          ask(() => {
            setBusy('remove');
          connectionsApi
            .remove(connection.id)
              .then(onRemoved)
              .finally(() => setBusy(null));
          })
        }
      >
        <Trash2 size={16} aria-hidden="true" />
        {t('connections.forget')}
      </button>
    </>
  );
}

function SectionTitle({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="flex items-center gap-2">
      {icon}
      {children}
    </span>
  );
}

const ConnectionsSection = () => {
  const { t } = useI18n();
  const { user } = useAuth();
  const [info, setInfo] = useState<ConnectionsInfo | null>(null);
  const [loadError, setLoadError] = useState('');

  const [canvasToken, setCanvasToken] = useState('');
  const [canvasBusy, setCanvasBusy] = useState(false);
  const [canvasError, setCanvasError] = useState('');

  const [sso, setSso] = useState({ email: user?.email ?? '', username: '', password: '' });
  const [ssoBusy, setSsoBusy] = useState(false);
  const [ssoError, setSsoError] = useState('');

  useEffect(() => {
    connectionsApi
      .list()
      .then(setInfo)
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : t('common.networkError')));
  }, [t]);

  const find = (kind: Connection['kind']) => info?.connections.find((c) => c.kind === kind);
  const upsert = (c: Connection) => setInfo((prev) => (prev ? { ...prev, connections: [...prev.connections.filter((x) => x.id !== c.id), c] } : prev));
  const drop = (id: string) => setInfo((prev) => (prev ? { ...prev, connections: prev.connections.filter((x) => x.id !== id) } : prev));

  const saveCanvas = async (e: FormEvent) => {
    e.preventDefault();
    setCanvasBusy(true);
    setCanvasError('');
    try {
      upsert(await connectionsApi.saveCanvas({ token: canvasToken.trim() }));
      setCanvasToken('');
    } catch (err) {
      setCanvasError(err instanceof ApiError ? err.message : t('common.networkError'));
    } finally {
      setCanvasBusy(false);
    }
  };

  const saveSso = async (e: FormEvent) => {
    e.preventDefault();
    setSsoBusy(true);
    setSsoError('');
    try {
      upsert(await connectionsApi.saveSso({ email: sso.email.trim(), username: sso.username.trim() || undefined, password: sso.password }));
      setSso({ ...sso, password: '' });
    } catch (err) {
      setSsoError(err instanceof ApiError ? err.message : t('common.networkError'));
    } finally {
      setSsoBusy(false);
    }
  };

  if (loadError)
    return (
      <Notice tone="danger" icon={CircleAlert}>
        {loadError}
      </Notice>
    );
  if (!info)
    return (
      <div className="space-y-6">
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );

  const canvas = find('canvas');
  const ssoConn = find('sso');
  const degreeworks = find('degreeworks');
  const institution = info.institution;

  return (
    <>
      <Panel
        title={t('connections.canvasTitle')}
        description={
          <SectionTitle icon={<BookOpen size={15} aria-hidden="true" />}>
            {institution ? t('connections.canvasBody', { url: institution.canvas_base_url }) : t('connections.noInstitution')}
          </SectionTitle>
        }
        actions={<StatusBadge connection={canvas} />}
      >
        {canvas && (
          <div className="mb-5 flex flex-wrap gap-2">
            <ConnectionActions connection={canvas} onChange={upsert} onRemoved={() => drop(canvas.id)} />
          </div>
        )}
        {canvas?.status === 'error' && canvas.last_error && (
          <div className="mb-5">
            <Notice tone="danger" icon={CircleAlert}>
              {canvas.last_error}
            </Notice>
          </div>
        )}
        <form onSubmit={(e) => void saveCanvas(e)} className="space-y-4">
          <Field
            label={canvas ? t('connections.canvasReplace') : t('connections.canvasToken')}
            hint={
              <>
                {t('connections.canvasHowTo')}{' '}
                {institution && (
                  <a href={`${institution.canvas_base_url.replace(/\/$/, '')}/profile/settings`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-[var(--accent-700)] underline-offset-2 hover:underline dark:text-[var(--accent-300)]">
                    {t('connections.canvasOpen')}
                    <ExternalLink size={12} aria-hidden="true" />
                  </a>
                )}
              </>
            }
          >
            {(id, d) => <input id={id} aria-describedby={d} type="password" autoComplete="off" spellCheck={false} value={canvasToken} onChange={(e) => setCanvasToken(e.target.value)} className={`${input} font-mono`} />}
          </Field>
          {canvasError && (
            <Notice tone="danger" icon={CircleAlert}>
              {canvasError}
            </Notice>
          )}
          <button type="submit" disabled={canvasBusy || canvasToken.trim().length < 10 || !institution} className={btn.primary}>
            {canvasBusy && <Loader2 size={16} className="animate-spin" />}
            {t('connections.saveAndTest')}
          </button>
        </form>
      </Panel>

      {institution && (institution.has_outlook || institution.has_degreeworks) && (
        <Panel
          title={t('connections.ssoTitle', { institution: institution.name })}
          description={
            <SectionTitle icon={<Mail size={15} aria-hidden="true" />}>
              {t('connections.ssoBody')}
            </SectionTitle>
          }
          actions={<StatusBadge connection={ssoConn} />}
        >
          <Notice tone="neutral" icon={Lock}>
            <p className="font-medium">{t('connections.ssoSecurityTitle')}</p>
            <p className="mt-1">{t('connections.ssoSecurityBody')}</p>
          </Notice>

          {ssoConn && (
            <div className="mt-5 flex flex-wrap gap-2">
              <ConnectionActions connection={ssoConn} onChange={upsert} onRemoved={() => drop(ssoConn.id)} />
            </div>
          )}

          <form onSubmit={(e) => void saveSso(e)} className="mt-5 grid gap-5 sm:grid-cols-2">
            <Field label={t('connections.ssoEmail')}>
              {(id) => <input id={id} type="email" autoComplete="off" value={sso.email} onChange={(e) => setSso({ ...sso, email: e.target.value })} className={input} />}
            </Field>
            <Field label={t('connections.ssoUsername')} hint={t('connections.ssoUsernameHint')}>
              {(id, d) => <input id={id} aria-describedby={d} autoComplete="off" value={sso.username} onChange={(e) => setSso({ ...sso, username: e.target.value })} className={input} />}
            </Field>
            <div className="sm:col-span-2">
              <Field label={ssoConn ? t('connections.ssoReplacePassword') : t('connections.ssoPassword')}>
                {(id) => <PasswordInput id={id} autoComplete="off" value={sso.password} onChange={(e) => setSso({ ...sso, password: e.target.value })} />}
              </Field>
            </div>
            {ssoError && (
              <div className="sm:col-span-2">
                <Notice tone="danger" icon={CircleAlert}>
                  {ssoError}
                </Notice>
              </div>
            )}
            <div className="sm:col-span-2">
              <button type="submit" disabled={ssoBusy || !sso.email || !sso.password} className={btn.primary}>
                {ssoBusy ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} aria-hidden="true" />}
                {t('connections.ssoSave')}
              </button>
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{t('connections.ssoDuoHint')}</p>
            </div>
          </form>
        </Panel>
      )}

      {institution?.has_degreeworks && (
        <Panel
          title={t('connections.degreeworksTitle')}
          description={
            <SectionTitle icon={<GraduationCap size={15} aria-hidden="true" />}>
              {t('connections.degreeworksBody')}
            </SectionTitle>
          }
          actions={
            <Switch
              label={t('connections.degreeworksTitle')}
              checked={degreeworks?.status !== undefined && degreeworks.meta.enabled !== 'false'}
              disabled={!ssoConn}
              onChange={(next) => void connectionsApi.setDegreeWorks(next).then(upsert)}
            />
          }
        >
          {!ssoConn && <p className="text-sm text-slate-500 dark:text-slate-400">{t('connections.degreeworksNeedsSso')}</p>}
        </Panel>
      )}
    </>
  );
};

export default ConnectionsSection;
