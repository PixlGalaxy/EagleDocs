import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { getRuntimeConfig } from '../api/config';
import { authApi } from '../api/auth';
import { useAuth } from '../context/AuthContext';
import { dictionaries, isLanguage, type Language, type TranslationKey } from './translations';

export type Translate = (key: TranslationKey, vars?: Record<string, string | number>) => string;

interface I18nContextValue {
  language: Language;
  t: Translate;
  /** Signed in it persists to the account; signed out it only lasts for this browser. */
  setLanguage: (language: Language) => Promise<void>;
}

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

const STORAGE_KEY = 'studyhawk.language';

function storedLanguage(): Language | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return isLanguage(value) ? value : null;
  } catch {
    return null;
  }
}

function browserLanguage(): Language | null {
  const code = navigator.language?.slice(0, 2);
  return isLanguage(code) ? code : null;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const { user, updateUser } = useAuth();
  const [guestLanguage, setGuestLanguage] = useState<Language>(() => storedLanguage() ?? browserLanguage() ?? 'en');

  useEffect(() => {
    if (storedLanguage() || browserLanguage()) return;
    getRuntimeConfig()
      .then((config) => {
        if (isLanguage(config.language)) setGuestLanguage(config.language);
      })
      .catch(() => undefined);
  }, []);

  const language: Language = user && isLanguage(user.language) ? user.language : guestLanguage;

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const t: Translate = (key, vars) => {
    const template = dictionaries[language][key] ?? dictionaries.en[key] ?? key;
    if (!vars) return template;
    return Object.entries(vars).reduce((out, [name, value]) => out.replaceAll(`{${name}}`, String(value)), template);
  };

  const setLanguage = async (next: Language) => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private mode: the choice simply lasts until reload.
    }
    setGuestLanguage(next);
    if (user) updateUser(await authApi.appearance({ language: next }));
  };

  return <I18nContext.Provider value={{ language, t, setLanguage }}>{children}</I18nContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}
