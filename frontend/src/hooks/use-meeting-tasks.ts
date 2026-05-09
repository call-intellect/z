'use client';

import useSWR from 'swr';
import { useMemo } from 'react';
import { tasksApi } from '@/api/tasks.api';
import { taskFromApi, type TaskDomain } from '@/domain/task';

export function useMeetingTasks(meetingId: string | null | undefined) {
  const swr = useSWR(
    meetingId ? ['tasks', meetingId] : null,
    async () => {
      if (!meetingId) throw new Error('meetingId is required');
      return tasksApi.listForMeeting(meetingId);
    },
    { revalidateOnFocus: false },
  );

  const tasks: TaskDomain[] = useMemo(
    () => (swr.data?.items ? swr.data.items.map(taskFromApi) : []),
    [swr.data],
  );

  return {
    tasks,
    error: swr.error,
    isLoading: swr.isLoading,
    mutate: swr.mutate,
  };
}
