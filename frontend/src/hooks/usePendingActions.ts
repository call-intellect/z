'use client';

/**
 * usePendingActions — список pending-подтверждений (Фаза B1) + действие
 * «отложить» (snooze).
 *
 * Backend:
 *   - GET  /api/v1/pending-actions?limit=N
 *   - POST /api/v1/pending-actions/snooze
 *
 * После snooze ревалидируем список (и счётчик, если передан внешний
 * `onMutated` — но проще: list-хук и count-хук независимы, count сам
 * обновится по refreshInterval; для мгновенности страница/поповер может
 * вызвать count.mutate()).
 */

import { useCallback, useMemo } from 'react';
import useSWR from 'swr';

import {
  pendingActionsApi,
  type SnoozePendingActionRequest,
} from '@/api/pending-actions.api';
import {
  mapPendingAction,
  type PendingAction,
} from '@/domain/pending-action';

export function usePendingActions(
  orgId: string | null | undefined,
  limit = 50,
  enabled = true,
): {
  items: PendingAction[];
  isLoading: boolean;
  error: unknown;
  mutate: () => Promise<unknown>;
  snooze: (input: SnoozePendingActionRequest) => Promise<void>;
} {
  const key =
    orgId && enabled
      ? (['pending-actions.list', orgId, limit] as const)
      : null;

  const swr = useSWR(
    key,
    async () => {
      if (!orgId) throw new Error('orgId required');
      return pendingActionsApi.list(orgId, limit);
    },
    { revalidateOnFocus: true, keepPreviousData: true },
  );

  const items = useMemo<PendingAction[]>(
    () => (swr.data?.items ?? []).map(mapPendingAction),
    [swr.data],
  );

  const snooze = useCallback(
    async (input: SnoozePendingActionRequest) => {
      if (!orgId) throw new Error('orgId required');
      await pendingActionsApi.snooze(orgId, input);
      await swr.mutate();
    },
    [orgId, swr],
  );

  return {
    items,
    isLoading: swr.isLoading,
    error: swr.error,
    mutate: () => swr.mutate(),
    snooze,
  };
}
