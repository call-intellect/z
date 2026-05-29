'use client';

/**
 * Хук `useCanCreate` — единая точка для UI-блокировок мутирующих действий
 * (создание проекта, задачи, встречи и т.п.) в зависимости от статуса
 * подписки.
 *
 * ТЗ: plans/tz/2026-05-28-paywall-no-trial.md §4.2 — «Добавить визуальные
 * индикаторы read-only (disabled buttons, tooltips)».
 *
 * Возвращает:
 *   - `canCreate`     — true, если status === 'ACTIVE' (полный доступ);
 *   - `isReadOnly`    — true, если status ∈ DEMO/SUSPENDED/EXPIRED/CANCELED/PAST_DUE;
 *   - `loading`       — пока тянем GET /api/v1/billing/subscription;
 *   - `reason`        — короткая строка для tooltip («Оплатите подписку…»);
 *   - `showPaywall()` — открыть PaywallModal (тот же event, что 403-interceptor).
 *
 * Пока подписка ещё загружается (`loading`), `canCreate=false`, но
 * `isReadOnly=false` — компоненты могут показать spinner вместо disabled.
 */

import { useSubscription } from '@/hooks/useSubscription';

export interface CanCreateState {
  canCreate: boolean;
  isReadOnly: boolean;
  loading: boolean;
  reason: string | null;
  showPaywall: () => void;
}

const REASONS: Record<string, string> = {
  DEMO: 'Демо-режим: оплатите подписку, чтобы создавать данные',
  SUSPENDED: 'Подписка приостановлена. Оплатите для возобновления',
  EXPIRED: 'Подписка истекла. Оплатите для восстановления доступа',
  CANCELED: 'Подписка отменена. Оплатите, чтобы возобновить работу',
  PAST_DUE: 'Платёж не прошёл. Оплатите снова',
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

  const canCreate = status === 'ACTIVE';
  const reasonKey = status ?? 'DEMO';
  const reason = canCreate ? null : (REASONS[reasonKey] ?? REASONS.DEMO);

  return {
    canCreate,
    isReadOnly: !canCreate,
    loading: false,
    reason,
    showPaywall: showPaywallModal,
  };
}
