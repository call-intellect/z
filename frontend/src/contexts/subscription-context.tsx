'use client';

/**
 * SubscriptionContext — статус подписки организации + управление PaywallModal.
 *
 * Архитектура:
 *   - Provider тянет `GET /api/v1/billing/subscription` при mount.
 *   - Слушает CustomEvent `subscription:required` от api-client —
 *     при 403 с кодом `subscription_required` автоматически открывает
 *     PaywallModal (см. PaywallModal.tsx).
 *   - Refetch на window.focus (как EntitlementContext).
 *   - Сброс на auth:expired (как EntitlementContext).
 *
 * Используется через хук `useSubscription()`.
 *
 * ТЗ: plans/tz/2026-05-28-paywall-no-trial.md §4.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { billingApi } from '@/api/billing.api';
import type { SubscriptionStatusApi } from '@/api/types/billing';
import { useAuth } from '@/contexts/auth-context';

type SubscriptionState = {
  status: SubscriptionStatusApi | null;
  loading: boolean;
};

type SubscriptionContextValue = SubscriptionState & {
  refetch: () => Promise<void>;
  /** Открыть PaywallModal (вызывается из interceptor'а api-client). */
  showPaywallModal: () => void;
  /** Закрыть PaywallModal. */
  hidePaywallModal: () => void;
  /** Состояние PaywallModal. */
  isPaywallModalOpen: boolean;
};

const SubscriptionContext = createContext<SubscriptionContextValue | null>(null);

export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const { user, isLoading: authLoading } = useAuth();
  const [state, setState] = useState<SubscriptionState>({
    status: null,
    loading: true,
  });
  const [modalOpen, setModalOpen] = useState(false);

  const refetch = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true }));
    try {
      const sub = await billingApi.getSubscription();
      setState({
        status: sub?.status ?? null,
        loading: false,
      });
    } catch {
      // Сетевая / 401 / 403 — оставляем status=null, не блокируем UI.
      // 401 обработает auth-context через auth:expired.
      setState({ status: null, loading: false });
    }
  }, []);

  // Первая загрузка — после того как auth определил user.
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setState({ status: null, loading: false });
      return;
    }
    void refetch();
  }, [authLoading, user, refetch]);

  // Refetch на фокус вкладки.
  useEffect(() => {
    if (!user) return;
    const handler = () => {
      void refetch();
    };
    window.addEventListener('focus', handler);
    return () => window.removeEventListener('focus', handler);
  }, [user, refetch]);

  // Сброс при auth:expired (401).
  useEffect(() => {
    const handler = () => {
      setState({ status: null, loading: false });
      setModalOpen(false);
    };
    window.addEventListener('auth:expired', handler);
    return () => window.removeEventListener('auth:expired', handler);
  }, []);

  // Слушаем subscription:required от api-client → открываем PaywallModal.
  useEffect(() => {
    const handler = () => {
      setModalOpen(true);
    };
    window.addEventListener('subscription:required', handler);
    return () => window.removeEventListener('subscription:required', handler);
  }, []);

  const showPaywallModal = useCallback(() => setModalOpen(true), []);
  const hidePaywallModal = useCallback(() => setModalOpen(false), []);

  const value = useMemo<SubscriptionContextValue>(
    () => ({
      status: state.status,
      loading: state.loading,
      refetch,
      showPaywallModal,
      hidePaywallModal,
      isPaywallModalOpen: modalOpen,
    }),
    [state.status, state.loading, refetch, showPaywallModal, hidePaywallModal, modalOpen],
  );

  return (
    <SubscriptionContext.Provider value={value}>
      {children}
    </SubscriptionContext.Provider>
  );
}

export function useSubscription(): SubscriptionContextValue {
  const ctx = useContext(SubscriptionContext);
  if (!ctx) {
    throw new Error(
      'useSubscription must be used within <SubscriptionProvider>',
    );
  }
  return ctx;
}
