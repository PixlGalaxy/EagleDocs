import en from '@locales/en.json';
import es from '@locales/es.json';

// To add a language: drop its locales/<code>.json (matching en.json's keys,
// a mismatch fails the build), then add it here and in LANGUAGE_NAMES.
export const SUPPORTED_LANGUAGES = ['en', 'es'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export type TranslationKey = keyof typeof en;

// Every other locale is checked against en.json's shape, so a missing key fails the build.
export const dictionaries: Record<Language, Record<TranslationKey, string>> = { en, es };

/** Each language's own name for itself, shown regardless of the current UI language. */
export const LANGUAGE_NAMES: Record<Language, string> = {
  en: 'English',
  es: 'Español',
};

export function isLanguage(value: unknown): value is Language {
  return SUPPORTED_LANGUAGES.includes(value as Language);
}
