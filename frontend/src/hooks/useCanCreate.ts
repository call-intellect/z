"use client";

import { useSubscription } from "@/hooks/useSubscription";

export interface CanCreateState {
  canCreate: boolean;
  isReadOnly: boolean;
  loading: boolean;
  reason: string | null;
  showPaywall: () => void;
}

const REASONS: Record<string, string> = {
  DEMO: "Демо-режим: оплатите подписку, чтобы создавать данные",
  SUSPENDED: "Подписка приостановлена. Оплатите для возобновления",
  EXPIRED: "Подписка истекла. Оплатите для восстановления доступа",
  CANCELED: "Подписка отменена. Оплатите, чтобы возобновить работу",
  PAST_DUE: "Платёж не прошёл. Оплатите снова",
};

export function useCanCreate(): CanCreateState {
  const { status, loading, showPaywallModal } = useSubscription();

  if (loading) {
    return {
      canCreate: false,
      isReadOnly: false,
      loading: true,
      reason: null,
      showPaywall: showPaywallModal,
    };
  }

  const canCreate = status === "ACTIVE";
  const reasonKey = status ?? "DEMO";
  const reason = canCreate ? null : (REASONS[reasonKey] ?? REASONS.DEMO);

  return {
    canCreate,
    isReadOnly: !canCreate,
    loading: false,
    reason,
    showPaywall: showPaywallModal,
  };
}
