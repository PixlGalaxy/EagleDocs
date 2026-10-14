import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { adminApi, type GeneralSettings } from '../../api/admin';
import { useI18n } from '../../i18n/I18nContext';
import { LANGUAGE_NAMES, SUPPORTED_LANGUAGES } from '../../i18n/translations';
import { isSkinId, isThemeMode, type SkinId, type ThemeMode } from '../../theme/themes';
import ThemePicker from '../../components/ThemePicker';
import Toast from '../../components/ui/Toast';
import { Field, Panel, Skeleton, Switch } from '../../components/ui/kit';
import { btn, input } from '../../components/ui/styles';

export const GeneralSection = () => {
  const { t } = useI18n();
  const [s, setS] = useState<GeneralSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => {
    void adminApi.general().then(setS).catch(() => undefined);
  }, []);

  const save = async (patch?: Partial<GeneralSettings>) => {
    if (!s) return;
    setSaving(true);
    try {
      setS(await adminApi.saveGeneral(patch ?? s));
      setToast(t('common.saved'));
      setTimeout(() => setToast(''), 2500);
    } finally {
      setSaving(false);
    }
  };

  if (!s) return <Skeleton className="h-64 rounded-xl" />;

  return (
    <>
      <Panel
        title={t('admin.registrationTitle')}
        description={t('admin.registrationBody')}
        actions={
          <Switch
            label={t('admin.registrationTitle')}
            checked={s.registration_enabled}
            onChange={(on) => {
              setS({ ...s, registration_enabled: on });
              void save({ registration_enabled: on });
            }}
          />
        }
      />

      <Panel
        title={t('admin.mcpTitle')}
        description={t('admin.mcpBody')}
        actions={
          <Switch
            label={t('admin.mcpTitle')}
            checked={s.mcp_enabled}
            onChange={(on) => {
              setS({ ...s, mcp_enabled: on });
              void save({ mcp_enabled: on });
            }}
          />
        }
      />

      <Panel title={t('admin.generalTitle')} description={t('admin.generalBody')}>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={t('admin.defaultLanguage')}>
            {(id) => (
              <select id={id} value={s.default_language} onChange={(e) => setS({ ...s, default_language: e.target.value })} className={input}>
                {SUPPORTED_LANGUAGES.map((code) => (
                  <option key={code} value={code}>
                    {LANGUAGE_NAMES[code]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label={t('admin.sessionTtl')} hint={t('admin.sessionTtlHint')}>
            {(id, d) => <input id={id} aria-describedby={d} type="number" min={1} value={s.session_ttl_hours} onChange={(e) => setS({ ...s, session_ttl_hours: Number(e.target.value) })} className={`${input} font-mono`} />}
          </Field>
        </div>
        <button type="button" onClick={() => void save()} disabled={saving} className={`${btn.primary} mt-6`}>
          {saving && <Loader2 size={16} className="animate-spin" />}
          {t('common.save')}
        </button>
      </Panel>

      <Panel title={t('admin.defaultAppearance')} description={t('admin.defaultAppearanceBody')}>
        <ThemePicker
          mode={isThemeMode(s.default_theme_mode) ? s.default_theme_mode : 'system'}
          skin={isSkinId(s.default_theme_skin) ? s.default_theme_skin : 'eagle'}
          onModeChange={(mode: ThemeMode) => void save({ default_theme_mode: mode })}
          onSkinChange={(skin: SkinId) => void save({ default_theme_skin: skin })}
        />
      </Panel>
      {toast && <Toast message={toast} />}
    </>
  );
};
