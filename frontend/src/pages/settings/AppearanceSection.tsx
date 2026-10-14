import { useState } from 'react';
import { useTheme } from '../../context/ThemeContext';
import { useI18n } from '../../i18n/I18nContext';
import { LANGUAGE_NAMES, SUPPORTED_LANGUAGES, type Language } from '../../i18n/translations';
import type { SkinId, ThemeMode } from '../../theme/themes';
import ThemePicker from '../../components/ThemePicker';
import { Panel } from '../../components/ui/kit';

const AppearanceSection = () => {
  const { t, language, setLanguage } = useI18n();
  const { themeMode, skin, setAppearance } = useTheme();
  const [savingMode, setSavingMode] = useState(false);
  const [savingSkin, setSavingSkin] = useState<SkinId | null>(null);

  const changeMode = async (mode: ThemeMode) => {
    setSavingMode(true);
    try {
      await setAppearance({ mode });
    } finally {
      setSavingMode(false);
    }
  };

  const changeSkin = async (next: SkinId) => {
    setSavingSkin(next);
    try {
      await setAppearance({ skin: next });
    } finally {
      setSavingSkin(null);
    }
  };

  return (
    <>
      <Panel title={t('settings.appearanceTitle')}>
        <ThemePicker mode={themeMode} skin={skin} onModeChange={(m) => void changeMode(m)} onSkinChange={(s) => void changeSkin(s)} savingMode={savingMode} savingSkin={savingSkin} />
      </Panel>
      <Panel title={t('settings.languageTitle')} description={t('settings.languageHint')}>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('settings.languageTitle')}>
          {SUPPORTED_LANGUAGES.map((code: Language) => (
            <button
              key={code}
              type="button"
              role="radio"
              aria-checked={language === code}
              onClick={() => void setLanguage(code)}
              className={`rounded-lg border-2 px-4 py-2 text-sm font-medium transition ${
                language === code
                  ? 'border-[var(--accent-500)] bg-[var(--accent-50)] text-[var(--accent-800)] dark:bg-[var(--accent-500)]/10 dark:text-[var(--accent-200)]'
                  : 'border-slate-200 text-slate-700 hover:border-slate-300 dark:border-slate-700 dark:text-slate-200'
              }`}
            >
              {LANGUAGE_NAMES[code]}
            </button>
          ))}
        </div>
      </Panel>
    </>
  );
};

export default AppearanceSection;
