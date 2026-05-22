'use client';

import { useMemo } from 'react';
import useSWR from 'swr';

import { behaviorMetricsApi } from '@/api/behavior-metrics.api';
import {
  behaviorMetricsFromApi,
  type BehaviorMetricsDomain,
} from '@/domain/behavior-metrics';

/**
 * Поведенческие метрики одной встречи (Фаза B). Polling каждые 10s, пока
 * `status` остаётся `pending`, чтобы UI автоматически переключился из
 * skeleton на готовые данные. Останавливаем revalidation при `ready` /
 * `failed` / `low_confidence`.
 */
export function useMeetingBehaviorMetrics(
  meetingId: string | null | undefined,
): {
  data: BehaviorMetricsDomain | null;
  error: unknown;
  isLoading: boolean;
  mutate: () => void;
} {
  const swr = useSWR(
    meetingId ? ['behavior-metrics', meetingId] : null,
    async () => {
      if (!meetingId) throw new Error('meetingId is required');
      return behaviorMetricsApi.getForMeeting(meetingId);
    },
    {
      refreshInterval: (latest) => {
        if (!latest) return 5_000;
        return latest.status === 'pending' ? 10_000 : 0;
      },
      revalidateOnFocus: false,
    },
  );

  const data = useMemo(
    () => (swr.data ? behaviorMetricsFromApi(swr.data) : null),
    [swr.data],
  );

  return {
    data,
    error: swr.error,
    isLoading: swr.isLoading,
    mutate: () => swr.mutate(),
  };
}
