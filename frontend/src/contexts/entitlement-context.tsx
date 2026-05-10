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

import { entitlementsApi } from '@/api/entitlements.api';
import { ApiError } from '@/api/api-error';
import {
  entitlementFromApi,
  type EntitlementDomain,
} from '@/domain/entitlement';
import { useAuth } from '@/contexts/auth-context';

/**
 * EntitlementContext — клиентский кеш текущего entitlement (tier + features + quotas).
 *
 * Архитектура:
 *   - Provider тянет `GET /api/v1/me/entitlements` при mount (только если есть user).
 *   - Refetch на `window.focus` (на случай, если super_admin сменил tier из Z-Admin
 *     в другой вкладке — после возврата фокуса фронт догонит изменения).
 *   - Если backend вернул 401 / 403 — оставляем `entitlement=null` (graceful):
 *     `<TierGate>` в этом случае рендерит loading-skeleton либо children по
 *     дефолту (см. сам компонент). UX никогда не должен молча ломаться.
 *
 * Используется через хуки `useEntitlement(feature)` / `useQuota(quota)` —
 * см. `frontend/src/hooks/useEntitlement.ts`.
 */

type EntitlementState = {
  entitlement: EntitlementDomain | null;
  loading: boolean;
  error: Error | null;
};

type EntitlementContextValue = EntitlementState & {
  refetch: () => Promise<void>;
};

const EntitlementContext = createContext<EntitlementContextValue | null>(null);

export function EntitlementProvider({ children }: { children: ReactNode }) {
  const { user, isLoading: authLoading } = useAuth();
  const [state, setState] = useState<EntitlementState>({
    entitlement: null,
    loading: true,
    error: null,
  });

  const refetch = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const res = await entitlementsApi.getMe();
      setState({
        entitlement: entitlementFromApi(res),
        loading: false,
        error: null,
      });
    } catch (e) {
      // 401 — auth-context сам обработает; здесь просто оставляем null.
      // 403 (tenant_required) — у юзера нет Org; gating не имеет смысла.
      const err = e instanceof Error ? e : new Error('Не удалось загрузить тариф');
      setState({ entitlement: null, loading: false, error: err });
    }
  }, []);

  // Первая загрузка — после того как auth определил user.
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setState({ entitlement: null, loading: false, error: null });
      return;
    }
    void refetch();
  }, [authLoading, user, refetch]);

  // Рефреш при фокусе вкладки — чтобы догнать смены tier'а из Z-Admin.
  useEffect(() => {
    if (!user) return;
    const handler = () => {
      void refetch();
    };
    window.addEventListener('focus', handler);
    return () => window.removeEventListener('focus', handler);
  }, [user, refetch]);

  // Сброс на 401 от api-client (та же шина, что у auth-context).
  useEffect(() => {
    const handler = () => {
      setState({ entitlement: null, loading: false, error: null });
    };
    window.addEventListener('auth:expired', handler);
    return () => window.removeEventListener('auth:expired', handler);
  }, []);

  const value = useMemo<EntitlementContextValue>(
    () => ({
      entitlement: state.entitlement,
      loading: state.loading,
      error: state.error,
      refetch,
    }),
    [state.entitlement, state.loading, state.error, refetch],
  );

  return (
    <EntitlementContext.Provider value={value}>
      {children}
    </EntitlementContext.Provider>
  );
}

export function useEntitlementContext(): EntitlementContextValue {
  const ctx = useContext(EntitlementContext);
  if (!ctx) {
    throw new Error(
      'useEntitlementContext must be used within <EntitlementProvider>',
    );
  }
  return ctx;
}

/**
 * Хелпер для тестов / утилит, которым нужно отличить ApiError от прочего.
 * Не экспортируем напрямую — оставлено для документации намерения.
 */
export function isAuthApiError(e: unknown): boolean {
  return e instanceof ApiError && e.code === 'unauthorized';
}
