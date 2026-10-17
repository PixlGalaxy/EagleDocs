import { useEffect, useRef } from 'react';
import { authApi } from '../api/auth';
import { apiUrl } from '../api/client';
import { useAppConfig } from './AppConfigContext';
import { useAuth } from './AuthContext';

const ADMIN_CHANGED = 'studyhawk:admin-changed';

/**
 * Follows /api/live while signed in: when an admin saves anything, this tab re-reads the
 * runtime config and its user, and tells the pages (useAdminChanges) to re-read their data.
 * Nothing reloads, so a draft or a running chat is never lost.
 */
export function LiveUpdates() {
  const { user, updateUser } = useAuth();
  const { refresh } = useAppConfig();
  const signedIn = user !== null;

  useEffect(() => {
    if (!signedIn) return;
    const source = new EventSource(apiUrl('/live'), { withCredentials: true });
    const onChange = () => {
      refresh();
      authApi
        .me()
        .then(({ user: fresh }) => updateUser(fresh))
        .catch(() => undefined);
      window.dispatchEvent(new Event(ADMIN_CHANGED));
    };
    source.addEventListener('admin_changed', onChange);
    return () => source.close();
  }, [signedIn, refresh, updateUser]);

  return null;
}

/** Runs `reload` whenever an admin changes something, with the latest `reload`. */
// eslint-disable-next-line react-refresh/only-export-components
export function useAdminChanges(reload: () => void) {
  const latest = useRef(reload);
  useEffect(() => {
    latest.current = reload;
  });
  useEffect(() => {
    const handler = () => latest.current();
    window.addEventListener(ADMIN_CHANGED, handler);
    return () => window.removeEventListener(ADMIN_CHANGED, handler);
  }, []);
}
