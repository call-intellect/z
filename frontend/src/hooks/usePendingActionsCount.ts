'use client';

/**
 * usePendingActionsCount — лёгкий счётчик pending-подтверждений для бейджа
 * в сайдбаре («Подтверждения») и глобального колокольчика (Фаза B1).
 *
 * По образцу `useIntakePendingCount`: запрос делается только при наличии
 * orgId (enabled), обновление раз в 60 секунд — это второстепенный счётчик,
 * не давим на backend.
 *
 * Backend: `GET /api/v1/pending-actions/count`.
 */

import useSWR from 'swr';

import { pendingActionsApi } from '@/api/pending-actions.api';
import {
  mapPendingActionsCount,
  type PendingActionsCount,
} from '@/domain/pending-action';
import { BADGE_POLL_INTERVAL_MS, BADGE_DEDUPE_MS } from '@/lib/badge-polling';

export function usePendingActionsCount(
  orgId: string | null | undefined,
  enabled = true,
): {
  total: number;
  bySource: PendingActionsCount['bySource'];
  hasUrgent: boolean;
  isLoading: boolean;
  error: unknown;
  mutate: () => Promise<unknown>;
} {
  const key =
    orgId && enabled
      ? (['pending-actions.count', orgId] as const)
      : null;

  const swr = useSWR(
    key,
    async () => {
      if (!orgId) throw new Error('orgId required');
      const dto = await pendingActionsApi.count(orgId);
      return mapPendingActionsCount(dto);
    },
    {
      refreshInterval: BADGE_POLL_INTERVAL_MS,
      dedupingInterval: BADGE_DEDUPE_MS,
      revalidateOnFocus: true,
    },
  );

  const bySource = swr.data?.bySource ?? {
    curation: 0,
    conflict: 0,
    intake: 0,
    probe: 0,
  };

  return {
    total: swr.data?.total ?? 0,
    bySource,
    // conflict — единственный «urgent по природе» источник; красную точку
    // в колокольчике рисуем при наличии конфликтов (детальная severity
    // приходит в списке, но для счётчика достаточно этого сигнала).
    hasUrgent: bySource.conflict > 0,
    isLoading: swr.isLoading,
    error: swr.error,
    mutate: () => swr.mutate(),
  };
}
