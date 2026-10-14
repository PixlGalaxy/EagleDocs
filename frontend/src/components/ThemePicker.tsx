import { Check, Moon, Monitor, Sun, type LucideIcon } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import { SKINS, THEME_MODES, type SkinId, type ThemeMode } from '../theme/themes';
import type { TranslationKey } from '../i18n/translations';

export const MODE_ICON: Record<ThemeMode, LucideIcon> = { light: Sun, dark: Moon, system: Monitor };
// eslint-disable-next-line react-refresh/only-export-components
export const MODE_LABEL: Record<ThemeMode, TranslationKey> = {
  light: 'settings.themeModeLight',
  dark: 'settings.themeModeDark',
  system: 'settings.themeModeSystem',
};

interface Props {
  mode: ThemeMode;
  skin: SkinId;
  onModeChange: (mode: ThemeMode) => void;
  onSkinChange: (skin: SkinId) => void;
  /** True while any mode choice is being saved — disables the whole mode grid. */
  savingMode?: boolean;
  /** The skin currently being saved, if any — disables the whole skin grid. */
  savingSkin?: SkinId | null;
}

/**
 * Pure mode-picker + skin-grid UI, shared by the per-account Appearance
 * section (`SettingsPage.tsx`) and the admin panel's system-wide default
 * (`AppearanceDefaultsCard.tsx`). Saving and persistence are the caller's job.
 */
const ThemePicker = ({ mode, skin, onModeChange, onSkinChange, savingMode = false, savingSkin = null }: Props) => {
  const { t } = useI18n();

  return (
    <>
      <h3 className="font-medium text-slate-800 dark:text-slate-100">{t('settings.themeModeTitle')}</h3>
      <p className="mt-0.5 mb-3 text-xs text-slate-500 dark:text-slate-400">{t('settings.themeModeHint')}</p>
      <div className="grid max-w-md grid-cols-3 gap-3">
        {THEME_MODES.map((m) => {
          const selected = m === mode;
          const Icon = MODE_ICON[m];
          return (
            <button
              key={m}
              type="button"
              onClick={() => onModeChange(m)}
              disabled={savingMode}
              className={`relative flex flex-col items-center gap-2 rounded-xl border-2 p-4 transition disabled:cursor-wait ${
                selected
                  ? 'border-[var(--accent-500)] bg-[var(--accent-50)] dark:bg-[var(--accent-500)]/10'
                  : 'border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600'
              }`}
            >
              {selected && (
                <span className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent-500)] text-white shadow">
                  <Check size={12} strokeWidth={3} />
                </span>
              )}
              <Icon size={22} className="text-slate-600 dark:text-slate-300" />
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{t(MODE_LABEL[m])}</span>
            </button>
          );
        })}
      </div>

      <h3 className="mt-8 font-medium text-slate-800 dark:text-slate-100">{t('settings.skinTitle')}</h3>
      <p className="mt-0.5 mb-3 text-xs text-slate-500 dark:text-slate-400">{t('settings.skinHint')}</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
        {SKINS.map((def) => {
          const selected = def.id === skin;
          return (
            <button
              key={def.id}
              type="button"
              onClick={() => onSkinChange(def.id)}
              disabled={savingSkin !== null}
              className={`relative flex flex-col items-center gap-3 rounded-xl border-2 p-4 transition disabled:cursor-wait ${
                selected
                  ? 'bg-slate-50 dark:bg-slate-800'
                  : 'border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600'
              }`}
              style={selected ? { borderColor: def.dots[1], backgroundColor: `${def.dots[1]}1a` } : undefined}
            >
              {selected && (
                <span
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full text-white shadow"
                  style={{ backgroundColor: def.dots[1] }}
                >
                  <Check size={12} strokeWidth={3} />
                </span>
              )}
              <div className="flex gap-1.5">
                {def.dots.map((color) => (
                  <span key={color} className="h-4 w-4 rounded-full" style={{ backgroundColor: color }} />
                ))}
              </div>
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{t(def.labelKey)}</span>
            </button>
          );
        })}
      </div>
    </>
  );
};

export default ThemePicker;
