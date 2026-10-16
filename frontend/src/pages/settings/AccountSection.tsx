import { useRef, useState, type FormEvent } from 'react';
import { CircleAlert, Download, Loader2, Trash2, Upload } from 'lucide-react';
import { authApi, avatarsApi } from '../../api/auth';
import { ApiError } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useI18n } from '../../i18n/I18nContext';
import Avatar from '../../components/ui/Avatar';
import Toast from '../../components/ui/Toast';
import { Field, Notice, Panel } from '../../components/ui/kit';
import { btn, input } from '../../components/ui/styles';
import { PasswordInput } from '../auth/AuthShell';
import DeleteAccountPanel from './DeleteAccountPanel';
import ExportDataPanel from './ExportDataPanel';
import { dataExportApi } from '../../api/account';

const TIMEZONES = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['America/New_York'];

const AccountSection = () => {
  const { t } = useI18n();
  const { user, updateUser, logout } = useAuth();
  const [toast, setToast] = useState('');
  const avatarInput = useRef<HTMLInputElement>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState('');

  const [profile, setProfile] = useState({
    display_name: user?.display_name ?? '',
    major: user?.major ?? '',
    timezone: user?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState('');

  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState('');

  if (!user) return null;

  const flash = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(''), 2500);
  };

  const uploadAvatar = async (file: File | undefined) => {
    if (!file) return;
    setAvatarBusy(true);
    setAvatarError('');
    try {
      updateUser(await avatarsApi.upload(file));
    } catch (err) {
      setAvatarError(err instanceof ApiError ? err.message : t('common.networkError'));
    } finally {
      setAvatarBusy(false);
      if (avatarInput.current) avatarInput.current.value = '';
    }
  };

  const removeAvatar = async () => {
    setAvatarBusy(true);
    try {
      updateUser(await avatarsApi.remove());
    } finally {
      setAvatarBusy(false);
    }
  };

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault();
    setProfileBusy(true);
    setProfileError('');
    try {
      updateUser(await authApi.updateProfile({ display_name: profile.display_name.trim(), major: profile.major.trim() || null, timezone: profile.timezone }));
      flash(t('common.saved'));
    } catch (err) {
      setProfileError(err instanceof ApiError ? err.message : t('common.networkError'));
    } finally {
      setProfileBusy(false);
    }
  };

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    if (pw.next !== pw.confirm) {
      setPwError(t('auth.errConfirm'));
      return;
    }
    setPwBusy(true);
    setPwError('');
    try {
      await authApi.changePassword(pw.current, pw.next);
      // Every session is dropped server-side after a password change.
      await logout();
    } catch (err) {
      setPwError(err instanceof ApiError ? err.message : t('common.networkError'));
      setPwBusy(false);
    }
  };

  return (
    <>
      <Panel title={t('account.photo')} description={t('account.photoHint')}>
        <div className="flex flex-wrap items-center gap-5">
          <Avatar user={user} size={72} />
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => avatarInput.current?.click()} disabled={avatarBusy} className={btn.secondary}>
              {avatarBusy ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} aria-hidden="true" />}
              {t('account.uploadPhoto')}
            </button>
            {user.avatar_path && (
              <button type="button" onClick={() => void removeAvatar()} disabled={avatarBusy} className={btn.secondary}>
                <Trash2 size={16} aria-hidden="true" />
                {t('common.remove')}
              </button>
            )}
            <input ref={avatarInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => void uploadAvatar(e.target.files?.[0])} />
          </div>
        </div>
        {avatarError && (
          <div className="mt-4">
            <Notice tone="danger" icon={CircleAlert}>
              {avatarError}
            </Notice>
          </div>
        )}
      </Panel>

      <Panel title={t('account.profile')} description={t('account.profileHint')}>
        <form onSubmit={(e) => void saveProfile(e)} className="grid gap-5 sm:grid-cols-2">
          <Field label={t('auth.displayName')}>
            {(id) => <input id={id} value={profile.display_name} onChange={(e) => setProfile({ ...profile, display_name: e.target.value })} className={input} />}
          </Field>
          <Field label={t('account.major')} hint={t('account.majorHint')}>
            {(id, d) => <input id={id} aria-describedby={d} value={profile.major} onChange={(e) => setProfile({ ...profile, major: e.target.value })} className={input} />}
          </Field>
          <Field label={t('account.timezone')} hint={t('account.timezoneHint')}>
            {(id, d) => (
              <select id={id} aria-describedby={d} value={profile.timezone} onChange={(e) => setProfile({ ...profile, timezone: e.target.value })} className={input}>
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label={t('account.email')} hint={user.institution_name ?? undefined}>
            {(id, d) => <input id={id} aria-describedby={d} value={user.email} readOnly className={`${input} bg-slate-50 text-slate-500 dark:bg-slate-900`} />}
          </Field>
          {profileError && (
            <div className="sm:col-span-2">
              <Notice tone="danger" icon={CircleAlert}>
                {profileError}
              </Notice>
            </div>
          )}
          <div className="sm:col-span-2">
            <button type="submit" disabled={profileBusy} className={btn.primary}>
              {profileBusy && <Loader2 size={16} className="animate-spin" />}
              {t('common.save')}
            </button>
          </div>
        </form>
      </Panel>

      <Panel title={t('account.password')} description={t('account.passwordHint')}>
        <form onSubmit={(e) => void changePassword(e)} className="grid max-w-md gap-5">
          <Field label={t('account.currentPassword')}>
            {(id) => <PasswordInput id={id} autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required />}
          </Field>
          <Field label={t('auth.newPassword')} hint={t('auth.passwordHint', { min: 10 })}>
            {(id, d) => <PasswordInput id={id} aria-describedby={d} autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} required minLength={10} />}
          </Field>
          <Field label={t('auth.confirmPassword')}>
            {(id) => <PasswordInput id={id} autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} required />}
          </Field>
          {pwError && (
            <Notice tone="danger" icon={CircleAlert}>
              {pwError}
            </Notice>
          )}
          <div>
            <button type="submit" disabled={pwBusy || !pw.current || pw.next.length < 10} className={btn.primary}>
              {pwBusy && <Loader2 size={16} className="animate-spin" />}
              {t('account.changePassword')}
            </button>
          </div>
        </form>
      </Panel>

      <ExportDataPanel />

      <DeleteAccountPanel
        exportSlot={
          <div className="flex flex-wrap items-center gap-3">
            <a href={dataExportApi.downloadUrl()} download className={btn.secondary}>
              <Download size={16} aria-hidden="true" />
              {t('dataExport.download')}
            </a>
            <span className="text-sm text-slate-500 dark:text-slate-400">{t('account.deleteExportFirst')}</span>
          </div>
        }
      />

      {toast && <Toast message={toast} />}
    </>
  );
};

export default AccountSection;
