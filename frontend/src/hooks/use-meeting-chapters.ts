'use client';

import useSWR from 'swr';
import { useMemo } from 'react';
import { chaptersApi } from '@/api/chapters.api';
import { chapterFromApi, type ChapterDomain } from '@/domain/chapter';

export function useMeetingChapters(meetingId: string | null | undefined) {
  const swr = useSWR(
    meetingId ? ['chapters', meetingId] : null,
    async () => {
      if (!meetingId) throw new Error('meetingId is required');
      return chaptersApi.listForMeeting(meetingId);
    },
    { revalidateOnFocus: false },
  );

  const chapters: ChapterDomain[] = useMemo(
    () => (swr.data?.items ? swr.data.items.map(chapterFromApi) : []),
    [swr.data],
  );

  return {
    chapters,
    error: swr.error,
    isLoading: swr.isLoading,
    mutate: swr.mutate,
  };
}
