import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { ApiError } from '../api/client';
import { authApi } from '../api/auth';
import type { User } from '../api/types';

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  login: (usernameOrEmail: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** For flows that sign the user in without a password (email verification). */
  setSession: (user: User) => void;
  /** Lets pages that change the signed-in user (avatar, profile) sync it back. */
  updateUser: (user: User) => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    authApi
      .me()
      .then(({ user }) => setUser(user))
      .catch((err) => {
        if (!(err instanceof ApiError && err.status === 401)) console.error(err);
      })
      .finally(() => setIsLoading(false));
  }, []);

  const login = async (usernameOrEmail: string, password: string) => {
    const { user } = await authApi.login(usernameOrEmail, password);
    setUser(user);
  };

  const logout = async () => {
    try {
      await authApi.logout();
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) throw err;
    } finally {
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout, setSession: setUser, updateUser: setUser }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
