'use client';

import useSWR from 'swr';
import { useMemo } from 'react';
import { highlightsApi } from '@/api/highlights.api';
import { highlightFromApi, type HighlightDomain } from '@/domain/highlight';

const RENDER_PROCESSING = new Set(['queued', 'processing']);

export function useMeetingHighlights(meetingId: string | null | undefined) {
  const swr = useSWR(
    meetingId ? ['highlights', meetingId] : null,
    async () => {
      if (!meetingId) throw new Error('meetingId is required');
      return highlightsApi.listForMeeting(meetingId);
    },
    {
      revalidateOnFocus: false,
      // если есть рендеры в процессе — обновляем каждые 30 секунд
      refreshInterval: (latest) => {
        if (!latest?.items) return 0;
        const anyRendering = latest.items.some((h) =>
          RENDER_PROCESSING.has(h.renderStatus),
        );
        return anyRendering ? 30_000 : 0;
      },
    },
  );

  const highlights: HighlightDomain[] = useMemo(
    () => (swr.data?.items ? swr.data.items.map(highlightFromApi) : []),
    [swr.data],
  );

  return {
    highlights,
    error: swr.error,
    isLoading: swr.isLoading,
    mutate: swr.mutate,
  };
}
