import { useState } from 'react';
import { useTheme } from '../../context/ThemeContext';
import { useI18n } from '../../i18n/I18nContext';
import { LANGUAGE_NAMES, SUPPORTED_LANGUAGES, type Language } from '../../i18n/translations';
import type { SkinId, ThemeMode } from '../../theme/themes';
import ThemePicker from '../../components/ThemePicker';
import { Panel } from '../../components/ui/kit';
import { useAuth } from '../../context/AuthContext';
import { authApi } from '../../api/auth';

/** What a message sent while the agent works does (default: steer). */
const BUSY_MODES = [
  { value: 'steer', label: 'settings.busyInputSteer', hint: 'settings.busyInputSteerHint' },
  { value: 'queue', label: 'settings.busyInputQueue', hint: 'settings.busyInputQueueHint' },
  { value: 'interrupt', label: 'settings.busyInputInterrupt', hint: 'settings.busyInputInterruptHint' },
] as const;

const AppearanceSection = () => {
  const { t, language, setLanguage } = useI18n();
  const { themeMode, skin, setAppearance } = useTheme();
  const [savingMode, setSavingMode] = useState(false);
  const [savingSkin, setSavingSkin] = useState<SkinId | null>(null);
  const { user, updateUser } = useAuth();
  const [savingTrace, setSavingTrace] = useState(false);
  const [savingBusy, setSavingBusy] = useState(false);

  const changeBusy = async (busyInput: (typeof BUSY_MODES)[number]['value']) => {
    setSavingBusy(true);
    try {
      updateUser(await authApi.appearance({ busy_input: busyInput }));
    } finally {
      setSavingBusy(false);
    }
  };

  const changeTrace = async (toolTrace: 'compact' | 'full') => {
    setSavingTrace(true);
    try {
      updateUser(await authApi.appearance({ tool_trace: toolTrace }));
    } finally {
      setSavingTrace(false);
    }
  };

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
      <Panel title={t('settings.toolTraceTitle')} description={t('settings.toolTraceHint')}>
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={t('settings.toolTraceTitle')}>
          {(['compact', 'full'] as const).map((value) => {
            const on = (user?.tool_trace ?? 'compact') === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={savingTrace}
                onClick={() => void changeTrace(value)}
                className={`rounded-lg border-2 px-4 py-3 text-left transition disabled:opacity-60 ${
                  on ? 'border-[var(--accent-500)] bg-[var(--accent-50)] dark:bg-[var(--accent-500)]/10' : 'border-slate-200 hover:border-slate-300 dark:border-slate-700'
                }`}
              >
                <span className={`block text-sm font-medium ${on ? 'text-[var(--accent-800)] dark:text-[var(--accent-200)]' : 'text-slate-700 dark:text-slate-200'}`}>
                  {value === 'compact' ? t('settings.toolTraceCompact') : t('settings.toolTraceFull')}
                </span>
                <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                  {value === 'compact' ? t('settings.toolTraceCompactHint') : t('settings.toolTraceFullHint')}
                </span>
              </button>
            );
          })}
        </div>
      </Panel>
      <Panel title={t('settings.busyInputTitle')} description={t('settings.busyInputHint')}>
        <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label={t('settings.busyInputTitle')}>
          {BUSY_MODES.map(({ value, label, hint }) => {
            const on = (user?.busy_input ?? 'steer') === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={savingBusy}
                onClick={() => void changeBusy(value)}
                className={`rounded-lg border-2 px-4 py-3 text-left transition disabled:opacity-60 ${
                  on ? 'border-[var(--accent-500)] bg-[var(--accent-50)] dark:bg-[var(--accent-500)]/10' : 'border-slate-200 hover:border-slate-300 dark:border-slate-700'
                }`}
              >
                <span className={`block text-sm font-medium ${on ? 'text-[var(--accent-800)] dark:text-[var(--accent-200)]' : 'text-slate-700 dark:text-slate-200'}`}>{t(label)}</span>
                <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">{t(hint)}</span>
              </button>
            );
          })}
        </div>
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
