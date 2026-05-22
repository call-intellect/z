'use client';

import { useMemo } from 'react';
import useSWR from 'swr';

import { qualityScoreApi } from '@/api/quality-score.api';
import {
  qualityScoreResponseFromApi,
  type QualityScoreResponseDomain,
} from '@/domain/quality-score';

/**
 * AI-оценка качества встречи (Фаза C). Polling 10s, пока status='pending';
 * далее revalidation отключён до явного `mutate()`.
 */
export function useMeetingQualityScore(meetingId: string | null | undefined): {
  data: QualityScoreResponseDomain | null;
  error: unknown;
  isLoading: boolean;
  mutate: () => void;
} {
  const swr = useSWR(
    meetingId ? ['quality-score', meetingId] : null,
    async () => {
      if (!meetingId) throw new Error('meetingId is required');
      return qualityScoreApi.getForMeeting(meetingId);
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
    () => (swr.data ? qualityScoreResponseFromApi(swr.data) : null),
    [swr.data],
  );

  return {
    data,
    error: swr.error,
    isLoading: swr.isLoading,
    mutate: () => swr.mutate(),
  };
}
