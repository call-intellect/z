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

import { entitlementsApi } from "@/api/entitlements.api";
import { ApiError } from "@/api/api-error";
import {
  entitlementFromApi,
  type EntitlementDomain,
} from "@/domain/entitlement";
import { useAuth } from "@/contexts/auth-context";

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
      const err =
        e instanceof Error ? e : new Error("Не удалось загрузить тариф");
      setState({ entitlement: null, loading: false, error: err });
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setState({ entitlement: null, loading: false, error: null });
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
      setState({ entitlement: null, loading: false, error: null });
    };
    window.addEventListener("auth:expired", handler);
    return () => window.removeEventListener("auth:expired", handler);
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
      "useEntitlementContext must be used within <EntitlementProvider>",
    );
  }
  return ctx;
}

export function isAuthApiError(e: unknown): boolean {
  return e instanceof ApiError && e.code === "unauthorized";
}
