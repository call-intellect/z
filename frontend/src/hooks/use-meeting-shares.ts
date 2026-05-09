'use client';

import useSWR from 'swr';
import { useMemo } from 'react';
import { sharesApi } from '@/api/shares.api';
import { shareFromApi, type ShareDomain } from '@/domain/share';

export function useMeetingShares(meetingId: string | null | undefined) {
  const swr = useSWR(
    meetingId ? ['shares', 'meeting', meetingId] : null,
    async () => {
      if (!meetingId) throw new Error('meetingId is required');
      return sharesApi.listForMeeting(meetingId);
    },
    { revalidateOnFocus: false },
  );

  const shares: ShareDomain[] = useMemo(
    () => (swr.data?.items ? swr.data.items.map(shareFromApi) : []),
    [swr.data],
  );

  return {
    shares,
    error: swr.error,
    isLoading: swr.isLoading,
    mutate: swr.mutate,
  };
}
