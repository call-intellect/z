'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { authApi, type UserApi } from '@/api/auth.api';
import { ApiError } from '@/api/api-error';
import type { UserDomain } from '@/domain/user';

type AuthState = {
  user: UserDomain | null;
  isLoading: boolean;
};

type AuthContextValue = AuthState & {
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function toDomain(api: UserApi): UserDomain {
  return {
    id: api.id,
    email: api.email,
    name: api.name,
    role: api.role,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, isLoading: true });

  const refresh = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true }));
    try {
      const res = await authApi.me();
      setState({
        user: res.user ? toDomain(res.user) : null,
        isLoading: false,
      });
    } catch (e) {
      // 401 — это просто «нет сессии», не ошибка для UI.
      if (e instanceof ApiError && e.code === 'unauthorized') {
        setState({ user: null, isLoading: false });
        return;
      }
      // Сетевые / прочие — оставляем user=null, не блокируем UI.
      setState({ user: null, isLoading: false });
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // ignore — даже если backend недоступен, локально чистим.
    }
    setState({ user: null, isLoading: false });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Слушаем 'auth:expired' от api-client.
  useEffect(() => {
    const handler = () => {
      setState({ user: null, isLoading: false });
    };
    window.addEventListener('auth:expired', handler);
    return () => window.removeEventListener('auth:expired', handler);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: state.user,
      isLoading: state.isLoading,
      refresh,
      logout,
    }),
    [state.user, state.isLoading, refresh, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within <AuthProvider>');
  }
  return ctx;
}
