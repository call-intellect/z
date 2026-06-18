"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { billingApi } from "@/api/billing.api";
import type { SubscriptionStatusApi } from "@/api/types/billing";
import { useAuth } from "@/contexts/auth-context";

type SubscriptionState = {
  status: SubscriptionStatusApi | null;
  loading: boolean;
};

type SubscriptionContextValue = SubscriptionState & {
  refetch: () => Promise<void>;
  showPaywallModal: () => void;
  hidePaywallModal: () => void;
  isPaywallModalOpen: boolean;
};

const SubscriptionContext = createContext<SubscriptionContextValue | null>(
  null,
);

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
      setState({ status: null, loading: false });
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setState({ status: null, loading: false });
      return;
    }
    void refetch();
  }, [authLoading, user, refetch]);

  useEffect(() => {
    if (!user) return;
    const handler = () => {
      void refetch();
    };
    window.addEventListener("focus", handler);
    return () => window.removeEventListener("focus", handler);
  }, [user, refetch]);

  useEffect(() => {
    const handler = () => {
      setState({ status: null, loading: false });
      setModalOpen(false);
    };
    window.addEventListener("auth:expired", handler);
    return () => window.removeEventListener("auth:expired", handler);
  }, []);

  useEffect(() => {
    const handler = () => {
      setModalOpen(true);
    };
    window.addEventListener("subscription:required", handler);
    return () => window.removeEventListener("subscription:required", handler);
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
    [
      state.status,
      state.loading,
      refetch,
      showPaywallModal,
      hidePaywallModal,
      modalOpen,
    ],
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
      "useSubscription must be used within <SubscriptionProvider>",
    );
  }
  return ctx;
}
