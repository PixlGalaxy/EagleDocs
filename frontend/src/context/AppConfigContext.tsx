import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { getRuntimeConfig, type RuntimeConfig } from '../api/config';

const FALLBACK: RuntimeConfig = {
  language: 'en',
  defaultThemeMode: 'system',
  defaultThemeSkin: 'hawk',
  registrationEnabled: true,
  emailConfigured: true,
  betaTest: false,
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
}

const AppConfigContext = createContext<AppConfigValue>({ ...FALLBACK, loaded: false });

/** Names and switches come from the server so they change without a rebuild. */
export function AppConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AppConfigValue>({ ...FALLBACK, loaded: false });

  useEffect(() => {
    getRuntimeConfig()
      .then((remote) => setConfig({ ...FALLBACK, ...remote, loaded: true }))
      .catch(() => setConfig((prev) => ({ ...prev, loaded: true })));
  }, []);

  return <AppConfigContext.Provider value={config}>{children}</AppConfigContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAppConfig() {
  return useContext(AppConfigContext);
}
