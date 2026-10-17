import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getRuntimeConfig, type RuntimeConfig } from '../api/config';

const FALLBACK: RuntimeConfig = {
  language: 'en',
  defaultThemeMode: 'system',
  defaultThemeSkin: 'hawk',
  registrationEnabled: true,
  emailConfigured: true,
  betaTest: false,
  betaReport: false,
  institutions: [],
  billingEnabled: false,
  codexEnabled: false,
  mcpEnabled: false,
  vapidPublicKey: null,
  broadcast: null,
  statusPageUrl: null,
};

interface AppConfigValue extends RuntimeConfig {
  /** False until /api/config answered (or failed and fell back). */
  loaded: boolean;
  /** Reads the config again (an admin changed it: see LiveUpdates). */
  refresh: () => void;
}

const AppConfigContext = createContext<AppConfigValue>({ ...FALLBACK, loaded: false, refresh: () => undefined });

/** Names and switches come from the server so they change without a rebuild. */
export function AppConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<RuntimeConfig & { loaded: boolean }>({ ...FALLBACK, loaded: false });

  const refresh = useCallback(() => {
    getRuntimeConfig()
      .then((remote) => setConfig({ ...FALLBACK, ...remote, loaded: true }))
      .catch(() => setConfig((prev) => ({ ...prev, loaded: true })));
  }, []);

  useEffect(() => {
    refresh();
    // A tab coming back may have missed a change (signed out, offline, asleep).
    const onVisible = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);

  const value = useMemo(() => ({ ...config, refresh }), [config, refresh]);
  return <AppConfigContext.Provider value={value}>{children}</AppConfigContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAppConfig() {
  return useContext(AppConfigContext);
}
