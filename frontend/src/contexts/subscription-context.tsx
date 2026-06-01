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
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { toast } from 'sonner';

import { billingApi } from '@/api/billing.api';
import { onboardingApi } from '@/api/onboarding.api';
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
  const { user, currentOrgId, isLoading: authLoading } = useAuth();
  const [state, setState] = useState<SubscriptionState>({
    status: null,
    loading: true,
  });
  const [modalOpen, setModalOpen] = useState(false);
  // Fallback демо-сидинга срабатывает максимум один раз за монтирование.
  const demoEnsureFiredRef = useRef(false);

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

  // Fallback: если кабинет в DEMO-режиме, но синтетики ещё нет (старые Org до
  // выката авто-сидинга или неудавшийся seed) — фоном дозаливаем. Бэкенд
  // идемпотентен: enqueue только если реально нечего показать. При успешном
  // запуске поллим статус и один раз перезагружаем страницу с готовыми данными.
  useEffect(() => {
    if (state.loading || state.status !== 'DEMO' || !currentOrgId) return;
    if (demoEnsureFiredRef.current) return;
    demoEnsureFiredRef.current = true;

    let cancelled = false;
    void (async () => {
      try {
        const res = await onboardingApi.ensureDemoSeed(currentOrgId);
        if (!res.enqueued || cancelled) return;
        toast.loading('Готовим демо-данные «ТехноСтрим»…', { id: 'demo-seed' });
        // Поллим статус до завершения (макс ~40 сек), затем reload.
        const startedAt = Date.now();
        const poll = async (): Promise<void> => {
          if (cancelled) return;
          if (Date.now() - startedAt > 40_000) {
            toast.dismiss('demo-seed');
            return;
          }
          try {
            const { status } = await onboardingApi.getDemoSeedStatus(currentOrgId);
            if (status === 'completed') {
              toast.dismiss('demo-seed');
              if (!cancelled && typeof window !== 'undefined') {
                window.location.reload();
              }
              return;
            }
            if (status === 'failed') {
              toast.dismiss('demo-seed');
              return;
            }
          } catch {
            /* polling errors не критичны */
          }
          setTimeout(() => void poll(), 1500);
        };
        setTimeout(() => void poll(), 1500);
      } catch {
        /* fallback fire-and-forget — ошибки не показываем */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [state.loading, state.status, currentOrgId]);

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
