import { useEffect, useState, type FormEvent } from 'react';
import { CircleAlert, KeyRound, Loader2, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { adminApi, type AdminUserRow } from '../../api/admin';
import { ApiError } from '../../api/client';
import type { Institution, Role, Tier, UserStatus } from '../../api/types';
import { useAuth } from '../../context/AuthContext';
import { useI18n } from '../../i18n/I18nContext';
import Avatar from '../../components/ui/Avatar';
import Modal from '../../components/ui/Modal';
import { Badge, Field, Notice, Panel, Skeleton } from '../../components/ui/kit';
import SandboxDot from '../../components/ui/SandboxDot';
import { btn, input } from '../../components/ui/styles';
import { PasswordInput } from '../auth/AuthShell';

type Draft = {
  id?: string;
  email: string;
  username: string;
  display_name: string;
  password: string;
  role: Role;
  status: UserStatus;
  institution_id: string | null;
  tier_id: string | null;
};

const UsersSection = () => {
  const { t, language } = useI18n();
  const { user: me } = useAuth();
  const [rows, setRows] = useState<AdminUserRow[] | null>(null);
  const [query, setQuery] = useState('');
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [resetFor, setResetFor] = useState<AdminUserRow | null>(null);
  const [resetPw, setResetPw] = useState('');
  const [deleting, setDeleting] = useState<AdminUserRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => void adminApi.users(query).then(setRows).catch(() => setRows([])), 250);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    void adminApi.institutions().then(setInstitutions).catch(() => undefined);
    void adminApi.tiers().then(setTiers).catch(() => undefined);
  }, []);

  const statusTone = { active: 'success', pending: 'warning', disabled: 'neutral' } as const;
  const statusLabel = { active: t('admin.statusActive'), pending: t('admin.statusPending'), disabled: t('admin.statusDisabled') };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    setBusy(true);
    setError('');
    try {
      const saved = draft.id
        ? await adminApi.updateUser(draft.id, {
            email: draft.email,
            username: draft.username,
            display_name: draft.display_name,
            role: draft.role,
            status: draft.status,
            institution_id: draft.institution_id,
            tier_id: draft.tier_id,
          })
        : await adminApi.createUser({ email: draft.email, username: draft.username, display_name: draft.display_name, password: draft.password, role: draft.role, tier_id: draft.tier_id });
      setRows((prev) => [saved, ...(prev ?? []).filter((r) => r.id !== saved.id)]);
      setDraft(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.networkError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      title={t('admin.users')}
      description={t('admin.usersBody')}
      actions={
        <button
          type="button"
          onClick={() => setDraft({ email: '', username: '', display_name: '', password: '', role: 'user', status: 'active', institution_id: null, tier_id: null })}
          className={btn.primary}
        >
          <Plus size={16} aria-hidden="true" />
          {t('admin.newUser')}
        </button>
      }
    >
      <label className="relative mb-4 block max-w-sm">
        <span className="sr-only">{t('admin.searchUsers')}</span>
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('admin.searchUsers')} className={`${input} pl-9`} />
      </label>

      {rows === null ? (
        <Skeleton className="h-48" />
      ) : (
        <div className="-mx-5 overflow-x-auto sm:-mx-6">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-y border-slate-200 bg-slate-50 text-left text-xs font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
              <tr>
                <th className="px-5 py-2.5 sm:px-6">{t('admin.colUser')}</th>
                <th className="px-3 py-2.5">{t('admin.colInstitution')}</th>
                <th className="px-3 py-2.5">{t('admin.colStatus')}</th>
                <th className="px-3 py-2.5">{t('admin.colLastSeen')}</th>
                <th className="px-5 py-2.5 sm:px-6">
                  <span className="sr-only">{t('files.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="px-5 py-3 sm:px-6">
                    <div className="flex items-center gap-3">
                      <span className="relative shrink-0">
                        <Avatar user={row} size={32} />
                        <SandboxDot status={row.sandbox_status ?? 'off'} className="absolute -bottom-0.5 -right-0.5" />
                      </span>
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 truncate font-medium text-slate-900 dark:text-slate-100">
                          {row.display_name || row.username}
                          {row.role === 'admin' && <Badge tone="accent">{t('admin.roleAdmin')}</Badge>}
                        </p>
                        <p className="truncate text-xs text-slate-500 dark:text-slate-400">{row.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-slate-600 dark:text-slate-300">{row.institution_name ?? '-'}</td>
                  <td className="px-3 py-3">
                    <Badge tone={statusTone[row.status]}>{statusLabel[row.status]}</Badge>
                    {row.status === 'pending' && row.verification_expires_at && (
                      <p className="mt-1 text-xs text-slate-500">
                        {t('admin.expires', { date: new Date(row.verification_expires_at).toLocaleString(language, { dateStyle: 'short', timeStyle: 'short' }) })}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-3 text-slate-500 dark:text-slate-400">
                    {row.last_seen_at ? new Date(row.last_seen_at).toLocaleDateString(language, { dateStyle: 'medium' }) : '-'}
                  </td>
                  <td className="px-5 py-3 sm:px-6">
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => setDraft({ ...row, display_name: row.display_name ?? '', password: '' })}
                        className={btn.iconGhost}
                        aria-label={t('common.edit')}
                      >
                        <Pencil size={16} />
                      </button>
                      <button type="button" onClick={() => setResetFor(row)} className={btn.iconGhost} aria-label={t('admin.resetPassword')}>
                        <KeyRound size={16} />
                      </button>
                      <button type="button" onClick={() => setDeleting(row)} disabled={row.id === me?.id} className={`${btn.iconDanger} disabled:opacity-30`} aria-label={t('common.delete')}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {draft && (
        <Modal title={draft.id ? t('admin.editUser') : t('admin.newUser')} onClose={() => setDraft(null)}>
          <form onSubmit={(e) => void save(e)} className="grid gap-5 sm:grid-cols-2">
            <Field label={t('auth.displayName')}>
              {(id) => <input id={id} value={draft.display_name} onChange={(e) => setDraft({ ...draft, display_name: e.target.value })} className={input} />}
            </Field>
            <Field label={t('auth.username')}>
              {(id) => <input id={id} value={draft.username} onChange={(e) => setDraft({ ...draft, username: e.target.value })} className={input} required />}
            </Field>
            <div className="sm:col-span-2">
              <Field label={t('account.email')} hint={draft.id ? undefined : t('admin.newUserHint')}>
                {(id, d) => <input id={id} aria-describedby={d} type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} className={input} required />}
              </Field>
            </div>
            {!draft.id && (
              <div className="sm:col-span-2">
                <Field label={t('auth.password')}>
                  {(id) => <PasswordInput id={id} autoComplete="new-password" value={draft.password} onChange={(e) => setDraft({ ...draft, password: e.target.value })} required minLength={10} />}
                </Field>
              </div>
            )}
            <Field label={t('admin.role')}>
              {(id) => (
                <select id={id} value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value as Role })} disabled={draft.id === me?.id} className={input}>
                  <option value="user">{t('admin.roleUser')}</option>
                  <option value="admin">{t('admin.roleAdmin')}</option>
                </select>
              )}
            </Field>
            {draft.id && (
              <Field label={t('admin.colStatus')}>
                {(id) => (
                  <select id={id} value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as UserStatus })} disabled={draft.id === me?.id} className={input}>
                    <option value="active">{statusLabel.active}</option>
                    <option value="pending">{statusLabel.pending}</option>
                    <option value="disabled">{statusLabel.disabled}</option>
                  </select>
                )}
              </Field>
            )}
            {draft.id && (
              <Field label={t('admin.colInstitution')}>
                {(id) => (
                  <select id={id} value={draft.institution_id ?? ''} onChange={(e) => setDraft({ ...draft, institution_id: e.target.value || null })} className={input}>
                    <option value="">-</option>
                    {institutions.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            )}
            <Field label={t('admin.tier')}>
              {(id) => (
                <select id={id} value={draft.tier_id ?? ''} onChange={(e) => setDraft({ ...draft, tier_id: e.target.value || null })} className={input}>
                  <option value="">{t('admin.tierDefault')}</option>
                  {tiers.map((tier) => (
                    <option key={tier.id} value={tier.id}>
                      {tier.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            {error && (
              <div className="sm:col-span-2">
                <Notice tone="danger" icon={CircleAlert}>
                  {error}
                </Notice>
              </div>
            )}
            <div className="flex justify-end gap-2 sm:col-span-2">
              <button type="button" onClick={() => setDraft(null)} className={btn.secondary}>
                {t('common.cancel')}
              </button>
              <button type="submit" disabled={busy} className={btn.primary}>
                {busy && <Loader2 size={16} className="animate-spin" />}
                {t('common.save')}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {resetFor && (
        <Modal title={t('admin.resetPasswordFor', { name: resetFor.username })} onClose={() => setResetFor(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void adminApi.resetPassword(resetFor.id, resetPw).then(() => {
                setResetFor(null);
                setResetPw('');
              });
            }}
            className="space-y-5"
          >
            <Field label={t('auth.newPassword')} hint={t('admin.resetHint')}>
              {(id, d) => <PasswordInput id={id} aria-describedby={d} autoComplete="new-password" value={resetPw} onChange={(e) => setResetPw(e.target.value)} minLength={10} required />}
            </Field>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setResetFor(null)} className={btn.secondary}>
                {t('common.cancel')}
              </button>
              <button type="submit" disabled={resetPw.length < 10} className={btn.primary}>
                {t('common.save')}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {deleting && (
        <Modal title={t('admin.deleteUser')} onClose={() => setDeleting(null)}>
          <p className="text-sm text-slate-600 dark:text-slate-300">{t('admin.deleteUserBody', { name: deleting.username })}</p>
          <div className="mt-6 flex justify-end gap-2">
            <button type="button" onClick={() => setDeleting(null)} className={btn.secondary}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={() =>
                void adminApi.deleteUser(deleting.id).then(() => {
                  setRows((prev) => prev?.filter((r) => r.id !== deleting.id) ?? null);
                  setDeleting(null);
                })
              }
              className={btn.danger}
            >
              {t('common.delete')}
            </button>
          </div>
        </Modal>
      )}
    </Panel>
  );
};

export default UsersSection;
