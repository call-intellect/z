'use client';

/**
 * useIntakePendingCount — лёгкий счётчик pending-intake задач для бейджа
 * на пункте «Входящие» в Sidebar.
 *
 * Phase 3 Sprint 6: backend пока не предоставляет dedicated `count` —
 * запрашиваем `GET /intake?status=pending&limit=1` и используем
 * `data.total` (он есть в `ListIntakeResponseApi`).
 *
 * Hook сам по себе не делает запрос, если orgId / canTriage не заданы —
 * это позволяет вызывать его на любом пользователе без 403-шквала.
 */

import useSWR from 'swr';

import { intakeApi } from '@/api/tracker/intake.api';

export function useIntakePendingCount(
  orgId: string | null | undefined,
  enabled: boolean,
): {
  count: number;
  hasPending: boolean;
  isLoading: boolean;
  error: unknown;
} {
  const key =
    orgId && enabled ? (['tracker.intake.count', orgId] as const) : null;

  const swr = useSWR(
    key,
    async () => {
      if (!orgId) throw new Error('orgId required');
      return intakeApi.list(orgId, { status: 'pending', limit: 1 });
    },
    {
      // Раз в 60 секунд достаточно — это второстепенный счётчик; не давим
      // на backend и не путаем пользователя постоянным «пингом».
      refreshInterval: 60_000,
      revalidateOnFocus: true,
    },
  );

  const total = swr.data?.total ?? 0;

  return {
    count: total,
    hasPending: total > 0,
    isLoading: swr.isLoading,
    error: swr.error,
  };
}
