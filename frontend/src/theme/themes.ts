import type { TranslationKey } from '../i18n/translations';

// A real light/dark switch. 'system' follows the visitor's OS preference live.
export const THEME_MODES = ['light', 'dark', 'system'] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

export function isThemeMode(value: unknown): value is ThemeMode {
  return THEME_MODES.includes(value as ThemeMode);
}

export const SKIN_IDS = [
  'eagle',
  'default',
  'ocean',
  'sunset',
  'forest',
  'grape',
  'crimson',
  'solar',
  'arctic',
  'mint',
  'blossom',
  'ares',
  'poseidon',
  'zeus',
  'jade',
  'verdigris',
  'nebula',
  'sakura',
  'slate',
  'mono',
  'graphite',
  'ash',
  'terracotta',
  'olive',
  'maroon',
] as const;

export type SkinId = (typeof SKIN_IDS)[number];

export function isSkinId(value: unknown): value is SkinId {
  return SKIN_IDS.includes(value as SkinId);
}

interface SkinDef {
  id: SkinId;
  labelKey: TranslationKey;
  /** Three preview dots (300/500/700) for the picker card, light-to-dark. */
  dots: [string, string, string];
}

// One skin per Tailwind color family, reused as the --accent-* scale so every
// existing `indigo-*` utility (now `[var(--accent-*)]`) keeps the same light/dark
// balance Tailwind already tuned for that family — only the hue changes. A skin
// never picks the surface mode itself; it just recolors whichever mode is active.
export const SKINS: SkinDef[] = [
  { id: 'eagle', labelKey: 'settings.skinEagle', dots: ['#8fb4ff', '#2b6bff', '#0046d1'] },
  { id: 'default', labelKey: 'settings.skinDefault', dots: ['#a5b4fc', '#6366f1', '#4338ca'] },
  { id: 'ocean', labelKey: 'settings.skinOcean', dots: ['#67e8f9', '#06b6d4', '#0e7490'] },
  { id: 'sunset', labelKey: 'settings.skinSunset', dots: ['#fdba74', '#f97316', '#c2410c'] },
  { id: 'forest', labelKey: 'settings.skinForest', dots: ['#6ee7b7', '#10b981', '#047857'] },
  { id: 'grape', labelKey: 'settings.skinGrape', dots: ['#c4b5fd', '#8b5cf6', '#6d28d9'] },
  { id: 'crimson', labelKey: 'settings.skinCrimson', dots: ['#fda4af', '#f43f5e', '#be123c'] },
  { id: 'solar', labelKey: 'settings.skinSolar', dots: ['#fcd34d', '#f59e0b', '#b45309'] },
  { id: 'arctic', labelKey: 'settings.skinArctic', dots: ['#7dd3fc', '#0ea5e9', '#0369a1'] },
  { id: 'mint', labelKey: 'settings.skinMint', dots: ['#5eead4', '#14b8a6', '#0f766e'] },
  { id: 'blossom', labelKey: 'settings.skinBlossom', dots: ['#f0abfc', '#d946ef', '#a21caf'] },
  { id: 'ares', labelKey: 'settings.skinAres', dots: ['#fca5a5', '#ef4444', '#b91c1c'] },
  { id: 'poseidon', labelKey: 'settings.skinPoseidon', dots: ['#93c5fd', '#3b82f6', '#1d4ed8'] },
  { id: 'zeus', labelKey: 'settings.skinZeus', dots: ['#fde047', '#eab308', '#a16207'] },
  { id: 'jade', labelKey: 'settings.skinJade', dots: ['#86efac', '#22c55e', '#15803d'] },
  { id: 'verdigris', labelKey: 'settings.skinVerdigris', dots: ['#bef264', '#84cc16', '#4d7c0f'] },
  { id: 'nebula', labelKey: 'settings.skinNebula', dots: ['#d8b4fe', '#a855f7', '#7e22ce'] },
  { id: 'sakura', labelKey: 'settings.skinSakura', dots: ['#f9a8d4', '#ec4899', '#be185d'] },
  { id: 'slate', labelKey: 'settings.skinSlate', dots: ['#cbd5e1', '#64748b', '#334155'] },
  { id: 'mono', labelKey: 'settings.skinMono', dots: ['#d1d5db', '#6b7280', '#374151'] },
  { id: 'graphite', labelKey: 'settings.skinGraphite', dots: ['#d4d4d8', '#71717a', '#3f3f46'] },
  { id: 'ash', labelKey: 'settings.skinAsh', dots: ['#d4d4d4', '#737373', '#404040'] },
  { id: 'terracotta', labelKey: 'settings.skinTerracotta', dots: ['#d6d3d1', '#78716c', '#44403c'] },
  { id: 'olive', labelKey: 'settings.skinOlive', dots: ['#c2df90', '#8cbe37', '#608226'] },
  { id: 'maroon', labelKey: 'settings.skinMaroon', dots: ['#d8979d', '#b1434c', '#7a2e35'] },
];

export function skinDef(id: SkinId): SkinDef {
  return SKINS.find((skin) => skin.id === id) ?? SKINS[0]!;
}
