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

import { accountsApi } from '@/api/accounts.api';
import { ApiError } from '@/api/api-error';
import { authApi } from '@/api/auth.api';
import {
  mapAccountUserDtoToDomain,
  type AccountUser,
  type SignupSource,
} from '@/domain/account';

/**
 * AuthContext — единый клиентский источник правды о текущей сессии.
 *
 * Архитектура (что важно знать):
 *   - На сервере мы НЕ рендерим user (используем cookie z_session).
 *   - На клиенте — на mount делаем `accountsApi.me()`. Это работает и для
 *     standalone-юзеров, и для Crossmark-юзеров, и для админов
 *     (один и тот же CookieAuthGuard на бэке).
 *   - Если cookie битая / нет — backend вернёт 401 → apiClient эмитит
 *     `auth:expired` → мы сбрасываем user.
 *
 * Совместимость:
 *   - Crossmark deep-link (`(public)/m/[id]/ExchangeAndRender.tsx`) после
 *     обмена токена дёргает `refresh()`. Старый `authApi.exchange` работает
 *     как был — мы не трогаем `/api/v1/auth/*`.
 *   - Админ-логин (`/admin/login`) использует `adminApi.adminLogin` →
 *     потом дёргает `refresh()` (он подтянет user через accounts/me).
 *   - `logout()` чистит cookie и user локально через `accountsApi.logout()`.
 */

type AuthState = {
  user: AccountUser | null;
  isLoading: boolean;
};

type AuthContextValue = AuthState & {
  /** `mustChangePassword` пользователя — удобный шорткат для guard'ов. */
  mustChangePassword: boolean;
  /** `signupSource` пользователя — `null` если не залогинен. */
  signupSource: SignupSource | null;
  /** Перечитывает `accountsApi.me()` и обновляет state. */
  refresh: () => Promise<void>;
  /** Logout: backend revoke + локальный сброс. */
  logout: () => Promise<void>;
  /** Standalone-логин по email/паролю. После — refresh внутри. */
  loginStandalone: (email: string, password: string) => Promise<{ mustChangePassword: boolean }>;
  /** Lead-style регистрация. Возвращает `email_sent`. */
  register: (
    email: string,
    name: string,
    companyName?: string,
    honeypot?: string,
  ) => Promise<{ emailSent: boolean }>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, isLoading: true });

  const refresh = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true }));
    try {
      const res = await accountsApi.me();
      setState({
        user: res.user ? mapAccountUserDtoToDomain(res.user) : null,
        isLoading: false,
      });
    } catch (e) {
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
      // Сначала пробуем accounts/logout (revoke UserSession).
      await accountsApi.logout();
    } catch {
      try {
        // Fallback на старый /auth/logout (legacy Crossmark cookie).
        await authApi.logout();
      } catch {
        // ignore — даже если backend недоступен, локально чистим.
      }
    }
    setState({ user: null, isLoading: false });
  }, []);

  const loginStandalone = useCallback(
    async (email: string, password: string) => {
      const res = await accountsApi.login({ email, password });
      // После set-cookie мы должны прочитать актуального пользователя
      // (accountsApi.login сам возвращает user, но refresh держит state в
      // одном месте — без дублирования маппинга).
      await refresh();
      return { mustChangePassword: res.mustChangePassword };
    },
    [refresh],
  );

  const register = useCallback(
    async (email: string, name: string, companyName?: string, honeypot?: string) => {
      const res = await accountsApi.register({
        email,
        name,
        ...(companyName ? { companyName } : {}),
        ...(honeypot !== undefined ? { honeypot } : {}),
      });
      return { emailSent: res.email_sent };
    },
    [],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Слушаем 'auth:expired' от api-client (на любом 401 — сброс).
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
      mustChangePassword: state.user?.mustChangePassword ?? false,
      signupSource: state.user?.signupSource ?? null,
      refresh,
      logout,
      loginStandalone,
      register,
    }),
    [state.user, state.isLoading, refresh, logout, loginStandalone, register],
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
