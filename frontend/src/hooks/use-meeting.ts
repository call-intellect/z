'use client';

import useSWR from 'swr';
import { useMemo } from 'react';
import { meetingsApi } from '@/api/meetings.api';
import { meetingFromApi } from '@/domain/meeting';

const PROCESSING_STATES = new Set(['queued', 'processing']);

/**
 * Хук получения встречи с её детальной частью.
 * Если хотя бы один из под-этапов AI-pipeline ещё в работе, делаем
 * polling каждые 60 секунд, чтобы UI обновлялся без F5.
 */
export function useMeeting(meetingId: string | null | undefined) {
  const swr = useSWR(
    meetingId ? ['meeting', meetingId] : null,
    async () => {
      if (!meetingId) throw new Error('meetingId is required');
      const data = await meetingsApi.get(meetingId);
      return data;
    },
    {
      revalidateOnFocus: false,
      refreshInterval: (latest) => {
        if (!latest) return 0;
        const candidates: Array<unknown> = [
          latest.chaptersStatus,
          latest.tasksStatus,
          latest.embeddingsStatus,
        ];
        return candidates.some(
          (s) => typeof s === 'string' && PROCESSING_STATES.has(s),
        )
          ? 60_000
          : 0;
      },
    },
  );

  const meeting = useMemo(
    () => (swr.data ? meetingFromApi(swr.data) : null),
    [swr.data],
  );

  return {
    /** Доменная модель meeting (camelCase, Date). */
    meeting,
    /** Сырой ответ API (с participants и т.д.). */
    raw: swr.data,
    error: swr.error,
    isLoading: swr.isLoading,
    mutate: swr.mutate,
  };
}
