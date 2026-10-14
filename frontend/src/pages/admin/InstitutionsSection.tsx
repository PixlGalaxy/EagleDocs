import { useEffect, useState, type FormEvent } from 'react';
import { Building2, CircleAlert, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import { adminApi } from '../../api/admin';
import { ApiError } from '../../api/client';
import type { Institution } from '../../api/types';
import { useConfirm } from '../../components/ui/confirm';
import { useI18n } from '../../i18n/I18nContext';
import Modal from '../../components/ui/Modal';
import { Badge, EmptyState, Field, Notice, Panel, Skeleton, Switch } from '../../components/ui/kit';
import { btn, card, input } from '../../components/ui/styles';

type BuiltinSkill = Awaited<ReturnType<typeof adminApi.builtinSkills>>[number];

const EMPTY: Partial<Institution> & { name: string } = {
  name: '',
  canvas_base_url: '',
  degreeworks_url: null,
  sso_login_url: null,
  outlook_url: null,
  enabled: true,
  domains: [],
  skills: {},
};

const InstitutionsSection = () => {
  const { t } = useI18n();
  const ask = useConfirm();
  const [items, setItems] = useState<Institution[] | null>(null);
  const [skills, setSkills] = useState<BuiltinSkill[]>([]);
  const [draft, setDraft] = useState<(Partial<Institution> & { name: string }) | null>(null);
  const [newDomain, setNewDomain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void adminApi.institutions().then(setItems).catch(() => setItems([]));
    void adminApi.builtinSkills().then(setSkills).catch(() => undefined);
  }, []);

  const addDomain = () => {
    const domain = newDomain.trim().toLowerCase().replace(/^@/, '');
    if (!draft || !domain || draft.domains?.some((d) => d.domain === domain)) return;
    setDraft({ ...draft, domains: [...(draft.domains ?? []), { id: `new-${domain}`, domain, include_subdomains: true }] });
    setNewDomain('');
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    setBusy(true);
    setError('');
    try {
      const saved = await adminApi.saveInstitution(draft);
      setItems((prev) => [...(prev ?? []).filter((i) => i.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name)));
      setDraft(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.networkError'));
    } finally {
      setBusy(false);
    }
  };

  const skillAvailable = (skill: BuiltinSkill) =>
    !skill.requires || (skill.requires === 'degreeworks' ? !!draft?.degreeworks_url : !!draft?.outlook_url);

  return (
    <Panel
      title={t('admin.institutions')}
      description={t('admin.institutionsBody')}
      actions={
        <button type="button" onClick={() => setDraft({ ...EMPTY })} className={btn.primary}>
          <Plus size={16} aria-hidden="true" />
          {t('admin.newInstitution')}
        </button>
      }
    >
      {items === null ? (
        <Skeleton className="h-32" />
      ) : items.length === 0 ? (
        <EmptyState icon={Building2} title={t('admin.noInstitutions')} description={t('admin.noInstitutionsBody')} />
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {items.map((inst) => (
            <li key={inst.id} className={`${card} p-4`}>
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 font-medium text-slate-900 dark:text-slate-100">
                    {inst.name}
                    {!inst.enabled && <Badge>{t('admin.disabled')}</Badge>}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{inst.canvas_base_url}</p>
                </div>
                <button type="button" onClick={() => setDraft(inst)} className={btn.iconGhost} aria-label={t('common.edit')}>
                  <Pencil size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => ask(() => void adminApi.deleteInstitution(inst.id).then(() => setItems((prev) => prev?.filter((i) => i.id !== inst.id) ?? null)))}
                  className={btn.iconDanger}
                  aria-label={t('common.delete')}
                >
                  <Trash2 size={16} />
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {inst.domains.map((d) => (
                  <Badge key={d.id} tone="accent">
                    @{d.domain}
                  </Badge>
                ))}
                {inst.degreeworks_url && <Badge>Degree Works</Badge>}
                {inst.outlook_url && <Badge>Outlook</Badge>}
                {inst.user_count !== undefined && <Badge>{t('admin.userCount', { count: inst.user_count })}</Badge>}
              </div>
            </li>
          ))}
        </ul>
      )}

      {draft && (
        <Modal title={draft.id ? t('admin.editInstitution') : t('admin.newInstitution')} onClose={() => setDraft(null)} size="lg">
          <form onSubmit={(e) => void save(e)} className="space-y-6">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label={t('admin.instName')}>
                {(id) => <input id={id} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={input} required />}
              </Field>
              <Field label={t('admin.canvasUrl')} hint="https://fgcu.instructure.com">
                {(id, d) => <input id={id} aria-describedby={d} type="url" value={draft.canvas_base_url ?? ''} onChange={(e) => setDraft({ ...draft, canvas_base_url: e.target.value })} className={input} required />}
              </Field>
              <Field label={t('admin.outlookUrl')} hint={t('admin.outlookUrlHint')}>
                {(id, d) => <input id={id} aria-describedby={d} type="url" value={draft.outlook_url ?? ''} onChange={(e) => setDraft({ ...draft, outlook_url: e.target.value || null })} className={input} />}
              </Field>
              <Field label={t('admin.degreeworksUrl')} hint={t('admin.degreeworksUrlHint')}>
                {(id, d) => <input id={id} aria-describedby={d} type="url" value={draft.degreeworks_url ?? ''} onChange={(e) => setDraft({ ...draft, degreeworks_url: e.target.value || null })} className={input} />}
              </Field>
            </div>

            <div>
              <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300">{t('admin.domains')}</h3>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{t('admin.domainsHint')}</p>
              <ul className="mt-3 space-y-2">
                {draft.domains?.map((d) => (
                  <li key={d.id} className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
                    <span className="min-w-0 flex-1 font-mono text-sm">@{d.domain}</span>
                    <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                      {t('admin.subdomains')}
                      <Switch
                        label={t('admin.subdomains')}
                        checked={d.include_subdomains}
                        onChange={(on) => setDraft({ ...draft, domains: draft.domains?.map((x) => (x.id === d.id ? { ...x, include_subdomains: on } : x)) })}
                      />
                    </label>
                    <button type="button" onClick={() => setDraft({ ...draft, domains: draft.domains?.filter((x) => x.id !== d.id) })} className={btn.iconDanger} aria-label={t('common.remove')}>
                      <X size={15} />
                    </button>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex gap-2">
                <label htmlFor="new-domain" className="sr-only">
                  {t('admin.addDomain')}
                </label>
                <input
                  id="new-domain"
                  value={newDomain}
                  onChange={(e) => setNewDomain(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addDomain();
                    }
                  }}
                  placeholder="fgcu.edu"
                  className={`${input} font-mono`}
                />
                <button type="button" onClick={addDomain} className={btn.secondary}>
                  {t('admin.addDomain')}
                </button>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300">{t('admin.instSkills')}</h3>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{t('admin.instSkillsHint')}</p>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {skills.map((skill) => {
                  const available = skillAvailable(skill);
                  return (
                    <li key={skill.slug} className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-slate-800 dark:text-slate-200">{skill.name}</span>
                        {!available && <span className="block text-xs text-slate-500">{skill.requires === 'degreeworks' ? t('admin.needsDegreeworks') : t('admin.needsOutlook')}</span>}
                      </span>
                      <Switch
                        label={skill.name}
                        disabled={!available}
                        checked={available && (draft.skills?.[skill.slug] ?? true)}
                        onChange={(on) => setDraft({ ...draft, skills: { ...draft.skills, [skill.slug]: on } })}
                      />
                    </li>
                  );
                })}
              </ul>
            </div>

            <label className="flex items-center gap-3 text-sm text-slate-700 dark:text-slate-300">
              <Switch label={t('admin.instEnabled')} checked={draft.enabled ?? true} onChange={(on) => setDraft({ ...draft, enabled: on })} />
              {t('admin.instEnabled')}
            </label>

            {error && (
              <Notice tone="danger" icon={CircleAlert}>
                {error}
              </Notice>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setDraft(null)} className={btn.secondary}>
                {t('common.cancel')}
              </button>
              <button type="submit" disabled={busy || !draft.domains?.length} className={btn.primary}>
                {busy && <Loader2 size={16} className="animate-spin" />}
                {t('common.save')}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </Panel>
  );
};

export default InstitutionsSection;
