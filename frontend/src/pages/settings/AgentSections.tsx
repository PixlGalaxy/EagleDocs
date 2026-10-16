import { useEffect, useState, type FormEvent } from 'react';
import { BookMarked, Brain, CalendarClock, CircleAlert, Library, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import { memoryApi, ragsApi, schedulesApi, skillsApi } from '../../api/account';
import { ApiError } from '../../api/client';
import type { MemoryDoc, MemoryInfo, RagSummary, Schedule, Skill } from '../../api/types';
import type { TranslationKey } from '../../i18n/translations';
import { useConfirm } from '../../components/ui/confirm';
import { useI18n } from '../../i18n/I18nContext';
import Modal from '../../components/ui/Modal';
import { Badge, EmptyState, Field, Notice, Panel, Skeleton, Switch } from '../../components/ui/kit';
import { btn, input } from '../../components/ui/styles';

// ------------------------------------------------------------------ schedules

const CRON_PRESETS = [
  { cron: '0 8 * * 1', key: 'schedules.presetMonday' },
  { cron: '0 20 * * *', key: 'schedules.presetNightly' },
  { cron: '0 9 * * 1-5', key: 'schedules.presetWeekdays' },
  { cron: 'every 2h', key: 'schedules.presetEvery2h' },
] as const;

export const SchedulesSection = () => {
  const { t, language } = useI18n();
  const ask = useConfirm();
  const [items, setItems] = useState<Schedule[] | null>(null);
  const [editing, setEditing] = useState<Partial<Schedule> | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    schedulesApi
      .list()
      .then(setItems)
      .catch(() => setItems([]));
  }, []);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setError('');
    try {
      const body = { name: editing.name ?? '', cron: editing.cron ?? '', prompt: editing.prompt ?? '', enabled: editing.enabled ?? true };
      const saved = editing.id ? await schedulesApi.update(editing.id, body) : await schedulesApi.create(body);
      setItems((prev) => [...(prev ?? []).filter((s) => s.id !== saved.id), saved]);
      setEditing(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.networkError'));
    }
  };

  return (
    <Panel
      title={t('schedules.title')}
      description={t('schedules.body')}
      actions={
        <button type="button" onClick={() => setEditing({ cron: CRON_PRESETS[0].cron, enabled: true })} className={btn.secondary}>
          <Plus size={16} aria-hidden="true" />
          {t('schedules.new')}
        </button>
      }
    >
      {items === null ? (
        <Skeleton className="h-24" />
      ) : items.length === 0 ? (
        <EmptyState icon={CalendarClock} title={t('schedules.emptyTitle')} description={t('schedules.emptyBody')} />
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {items.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-slate-800 dark:text-slate-200">{s.name}</p>
                <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                  <code className="font-mono">{s.cron}</code>
                  {s.next_run_at && ` · ${t('schedules.next', { date: new Date(s.next_run_at).toLocaleString(language, { dateStyle: 'medium', timeStyle: 'short' }) })}`}
                </p>
              </div>
              <Switch
                label={s.name}
                checked={s.enabled}
                onChange={(enabled) => void schedulesApi.update(s.id, { enabled }).then((u) => setItems((prev) => prev?.map((x) => (x.id === u.id ? u : x)) ?? null))}
              />
              <button type="button" onClick={() => setEditing(s)} className={btn.iconGhost} aria-label={t('common.edit')}>
                <Pencil size={16} />
              </button>
              <button type="button" onClick={() => ask(() => void schedulesApi.remove(s.id).then(() => setItems((prev) => prev?.filter((x) => x.id !== s.id) ?? null)))} className={btn.iconDanger} aria-label={t('common.delete')}>
                <Trash2 size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <Modal title={editing.id ? t('schedules.edit') : t('schedules.new')} onClose={() => setEditing(null)}>
          <form onSubmit={(e) => void save(e)} className="space-y-5">
            <Field label={t('schedules.name')}>
              {(id) => <input id={id} value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className={input} required />}
            </Field>
            <Field label={t('schedules.when')} hint={t('schedules.cronHint')}>
              {(id, d) => (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    {CRON_PRESETS.map((p) => (
                      <button
                        key={p.cron}
                        type="button"
                        onClick={() => setEditing({ ...editing, cron: p.cron })}
                        className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${editing.cron === p.cron ? 'border-[var(--accent-500)] bg-[var(--accent-50)] text-[var(--accent-800)] dark:bg-[var(--accent-500)]/10 dark:text-[var(--accent-200)]' : 'border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-300'}`}
                      >
                        {t(p.key)}
                      </button>
                    ))}
                  </div>
                  <input id={id} aria-describedby={d} value={editing.cron ?? ''} onChange={(e) => setEditing({ ...editing, cron: e.target.value })} className={`${input} font-mono`} required />
                </div>
              )}
            </Field>
            <Field label={t('schedules.prompt')} hint={t('schedules.promptHint')}>
              {(id, d) => <textarea id={id} aria-describedby={d} rows={4} value={editing.prompt ?? ''} onChange={(e) => setEditing({ ...editing, prompt: e.target.value })} className={input} required />}
            </Field>
            {error && (
              <Notice tone="danger" icon={CircleAlert}>
                {error}
              </Notice>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(null)} className={btn.secondary}>
                {t('common.cancel')}
              </button>
              <button type="submit" className={btn.primary}>
                {t('common.save')}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </Panel>
  );
};

// ------------------------------------------------------------------ memory

/** USER.md and MEMORY.md keep one fact per entry; here each line is one entry. */
const ENTRY = /\n?§\n?/;
const toLines = (text: string) =>
  text
    .split(ENTRY)
    .map((e) => e.trim().replace(/\s*\n\s*/g, ' '))
    .filter(Boolean)
    .join('\n');
const fromLines = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n§\n');

const DOCS: { doc: MemoryDoc; file: string; title: TranslationKey; body: TranslationKey; placeholder: TranslationKey; lines: boolean }[] = [
  { doc: 'user', file: 'USER.md', title: 'memory.userTitle', body: 'memory.userBody', placeholder: 'memory.userPlaceholder', lines: true },
  { doc: 'notes', file: 'MEMORY.md', title: 'memory.notesTitle', body: 'memory.notesBody', placeholder: 'memory.notesPlaceholder', lines: true },
  { doc: 'soul', file: 'SOUL.md', title: 'memory.soulTitle', body: 'memory.soulBody', placeholder: 'memory.soulPlaceholder', lines: false },
];

/** One of the agent's files: edit, see how full it is, save. */
const MemoryDocEditor = ({ spec, saved, limit, onSaved }: { spec: (typeof DOCS)[number]; saved: string; limit: number; onSaved: (info: Omit<MemoryInfo, 'paused'>) => void }) => {
  const { t } = useI18n();
  const shown = spec.lines ? toLines(saved) : saved;
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const value = draft ?? shown;
  const stored = spec.lines ? fromLines(value) : value.trim();
  const over = stored.length > limit;

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      onSaved(await memoryApi.save(spec.doc, stored));
      setDraft(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.networkError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title={t(spec.title)} description={t(spec.body)}>
      <label htmlFor={`memory-${spec.doc}`} className="mb-1.5 block font-mono text-xs text-slate-500 dark:text-slate-400">
        {spec.file}
      </label>
      <textarea
        id={`memory-${spec.doc}`}
        rows={spec.lines ? 6 : 5}
        value={value}
        placeholder={t(spec.placeholder)}
        onChange={(e) => setDraft(e.target.value)}
        className={`${input} font-mono text-[13px] leading-relaxed`}
      />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <span className={`text-xs ${over ? 'font-medium text-rose-600 dark:text-rose-400' : 'text-slate-500 dark:text-slate-400'}`}>
          {t('memory.usage', { used: stored.length, limit })}
        </span>
        {spec.lines && <span className="text-xs text-slate-500 dark:text-slate-400">{t('memory.oneFactPerLine')}</span>}
        {error && <span className="text-xs text-rose-600 dark:text-rose-400">{error}</span>}
        <div className="ml-auto flex gap-2">
          {draft !== null && (
            <button type="button" onClick={() => setDraft(null)} className={btn.secondary}>
              {t('common.cancel')}
            </button>
          )}
          <button type="button" disabled={draft === null || busy || over} onClick={() => void save()} className={btn.primary}>
            {busy && <Loader2 size={15} className="animate-spin" />}
            {t('common.save')}
          </button>
        </div>
      </div>
    </Panel>
  );
};

export const MemorySection = () => {
  const { t } = useI18n();
  const [info, setInfo] = useState<MemoryInfo | null>(null);

  useEffect(() => {
    memoryApi
      .get()
      .then(setInfo)
      .catch(() => setInfo({ docs: { soul: '', user: '', notes: '' }, limits: { soul: 3000, user: 1500, notes: 2500 }, paused: false }));
  }, []);

  if (!info) return <Skeleton className="h-64 rounded-xl" />;
  return (
    <>
      <Panel
        title={t('memory.title')}
        description={t('memory.body')}
        actions={
          <label className="flex items-center gap-3 text-sm text-slate-700 dark:text-slate-300">
            {t('memory.enabled')}
            <Switch
              label={t('memory.enabled')}
              checked={!info.paused}
              onChange={(on) => {
                setInfo({ ...info, paused: !on });
                void memoryApi.setPaused(!on);
              }}
            />
          </label>
        }
      >
        {info.paused ? (
          <Notice tone="neutral" icon={Brain}>
            {t('memory.pausedNote')}
          </Notice>
        ) : (
          <p className="text-sm text-slate-600 dark:text-slate-400">{t('memory.howItWorks')}</p>
        )}
      </Panel>
      {DOCS.map((spec) => (
        <MemoryDocEditor key={spec.doc} spec={spec} saved={info.docs[spec.doc]} limit={info.limits[spec.doc]} onSaved={(next) => setInfo({ ...info, ...next })} />
      ))}
    </>
  );
};

// ------------------------------------------------------------------ skills

export const SkillsSection = () => {
  const { t } = useI18n();
  const ask = useConfirm();
  const [skills, setSkills] = useState<Skill[] | null>(null);
  const [editing, setEditing] = useState<{ slug?: string; name: string; description: string; body_md: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    skillsApi
      .list()
      .then(setSkills)
      .catch(() => setSkills([]));
  }, []);

  const replace = (skill: Skill) => setSkills((prev) => (prev ? [...prev.filter((s) => s.slug !== skill.slug), skill].sort((a, b) => Number(b.builtin) - Number(a.builtin) || a.name.localeCompare(b.name)) : prev));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setBusy(true);
    setError('');
    try {
      const body = { name: editing.name.trim(), description: editing.description.trim(), body_md: editing.body_md };
      replace(editing.slug ? await skillsApi.update(editing.slug, body) : await skillsApi.create(body));
      setEditing(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.networkError'));
    } finally {
      setBusy(false);
    }
  };

  const builtin = skills?.filter((s) => s.builtin) ?? [];
  const custom = skills?.filter((s) => !s.builtin) ?? [];

  return (
    <>
      <Panel title={t('skills.builtinTitle')} description={t('skills.builtinBody')}>
        {skills === null ? (
          <Skeleton className="h-32" />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {builtin.map((skill) => (
              <li key={skill.slug} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-center gap-3">
                  <BookMarked size={16} className="shrink-0 text-slate-400" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{skill.name}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{skill.description}</p>
                  </div>
                  <Switch label={skill.name} checked={skill.enabled} onChange={(on) => void skillsApi.toggle(skill.slug, on).then(replace)} />
                </div>
                {skill.notes.length > 0 && (
                  <ul className="ml-7 mt-2 space-y-1">
                    {skill.notes.map((note) => (
                      <li key={note.id} className="flex items-start gap-2 rounded-md bg-slate-50 px-3 py-1.5 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                        <span className="min-w-0 flex-1">{note.note}</span>
                        <button
                          type="button"
                          onClick={() => ask(() => void skillsApi.removeNote(skill.slug, note.id).then(() => replace({ ...skill, notes: skill.notes.filter((n) => n.id !== note.id) })))}
                          aria-label={t('skills.removeNote')}
                          className="rounded p-0.5 hover:bg-slate-200 dark:hover:bg-slate-700"
                        >
                          <X size={13} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title={t('skills.customTitle')}
        description={t('skills.customBody')}
        actions={
          <button type="button" onClick={() => setEditing({ name: '', description: '', body_md: '' })} className={btn.secondary}>
            <Plus size={16} aria-hidden="true" />
            {t('skills.new')}
          </button>
        }
      >
        {custom.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('skills.noCustom')}</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {custom.map((skill) => (
              <li key={skill.slug} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-200">
                    {skill.name} <Badge>{t('skills.yours')}</Badge>
                  </p>
                  <p className="truncate text-xs text-slate-500 dark:text-slate-400">{skill.description}</p>
                </div>
                <Switch label={skill.name} checked={skill.enabled} onChange={(on) => void skillsApi.toggle(skill.slug, on).then(replace)} />
                <button type="button" onClick={() => setEditing({ slug: skill.slug, name: skill.name, description: skill.description, body_md: skill.body_md ?? '' })} className={btn.iconGhost} aria-label={t('common.edit')}>
                  <Pencil size={16} />
                </button>
                <button type="button" onClick={() => ask(() => void skillsApi.remove(skill.slug).then(() => setSkills((prev) => prev?.filter((s) => s.slug !== skill.slug) ?? null)))} className={btn.iconDanger} aria-label={t('common.delete')}>
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {editing && (
        <Modal title={editing.slug ? t('skills.edit') : t('skills.new')} onClose={() => setEditing(null)} size="lg">
          <form onSubmit={(e) => void save(e)} className="space-y-5">
            <Field label={t('skills.name')}>
              {(id) => <input id={id} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className={input} required maxLength={80} />}
            </Field>
            <Field label={t('skills.whenToUse')} hint={t('skills.whenToUseHint')}>
              {(id, d) => <input id={id} aria-describedby={d} value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} className={input} required maxLength={200} />}
            </Field>
            <Field label={t('skills.instructions')} hint={t('skills.instructionsHint')}>
              {(id, d) => <textarea id={id} aria-describedby={d} rows={12} value={editing.body_md} onChange={(e) => setEditing({ ...editing, body_md: e.target.value })} className={`${input} font-mono text-[13px]`} required />}
            </Field>
            {error && (
              <Notice tone="danger" icon={CircleAlert}>
                {error}
              </Notice>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(null)} className={btn.secondary}>
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
    </>
  );
};

// ------------------------------------------------------------------ RAGs

/** Indexes the agent built from the student's files (e.g. one per course); the source files may already be gone. */
export const RagsSection = () => {
  const { t, language } = useI18n();
  const ask = useConfirm();
  const [rags, setRags] = useState<RagSummary[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    ragsApi
      .list()
      .then(setRags)
      .catch(() => setRags([]));
  }, []);

  const remove = (rag: RagSummary) =>
    ask(
      () =>
        void ragsApi
          .remove(rag.id)
          .then(() => setRags((prev) => prev?.filter((r) => r.id !== rag.id) ?? null))
          .catch((err) => setError(err instanceof ApiError ? err.message : t('common.networkError'))),
      { title: t('rags.deleteTitle'), body: t('rags.deleteBody', { name: rag.name }) },
    );

  const date = (iso: string) => new Date(iso).toLocaleDateString(language, { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <Panel title={t('rags.title')} description={t('rags.body')}>
      {error && (
        <div className="mb-4">
          <Notice tone="danger" icon={CircleAlert}>
            {error}
          </Notice>
        </div>
      )}
      {rags === null ? (
        <Skeleton className="h-24" />
      ) : rags.length === 0 ? (
        <EmptyState icon={Library} title={t('rags.emptyTitle')} description={t('rags.emptyBody')} />
      ) : (
        <ul className="space-y-2">
          {rags.map((rag) => (
            <li key={rag.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <div className="flex items-start gap-3">
                <Library size={18} className="mt-0.5 shrink-0 text-[var(--accent-500)]" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-900 dark:text-slate-100">{rag.name}</p>
                  {rag.description && <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">{rag.description}</p>}
                  <p className="mt-1 text-xs text-slate-500">
                    {t('rags.meta', { sources: rag.sources.length, chunks: rag.chunks, size: rag.size_mb, date: date(rag.updated_at) })}
                  </p>
                </div>
                <button type="button" onClick={() => remove(rag)} className={btn.iconDanger} aria-label={t('rags.delete', { name: rag.name })}>
                  <Trash2 size={15} />
                </button>
              </div>
              {rag.sources.length > 0 && (
                <details className="mt-2 pl-7 text-sm">
                  <summary className="cursor-pointer text-xs font-medium text-slate-600 dark:text-slate-400">{t('rags.sources', { count: rag.sources.length })}</summary>
                  <ul className="mt-1.5 space-y-0.5">
                    {rag.sources.map((s) => (
                      <li key={s.path} className="flex gap-2 text-xs text-slate-600 dark:text-slate-400">
                        <span className="min-w-0 flex-1 truncate font-mono" title={s.path}>
                          {s.path.split('/').pop()}
                        </span>
                        <span className="shrink-0">{t('rags.sourceMeta', { pages: s.pages, chunks: s.chunks })}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
};
