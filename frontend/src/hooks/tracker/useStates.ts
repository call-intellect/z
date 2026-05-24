'use client';

/**
 * useStates — справочник статусов задач (`IssueState`) — колонки канбана.
 *
 * Подгружает `GET /api/v1/states?projectId=...` и маппит ApiDto → Domain.
 * Используется компонентом `Board.tsx` для рендера колонок и в drag-and-drop
 * (резолв stateId целевой колонки).
 *
 * Кэш ключ — `['tracker.states', orgId, projectId]`. States редко меняются,
 * поэтому отключаем `revalidateOnFocus`.
 */

import { useMemo } from 'react';
import useSWR from 'swr';

import { statesApi } from '@/api/tracker/states.api';
import {
  compareStatesForBoard,
  trackerStateFromApi,
  type TrackerState,
} from '@/domain/tracker';

export function useStates(
  orgId: string | null | undefined,
  projectId: string | null | undefined,
): {
  states: TrackerState[];
  total: number;
  error: unknown;
  isLoading: boolean;
  mutate: () => Promise<unknown>;
} {
  const key =
    orgId && projectId
      ? (['tracker.states', orgId, projectId] as const)
      : null;

  const swr = useSWR(
    key,
    async () => {
      if (!orgId || !projectId) throw new Error('orgId/projectId required');
      return statesApi.list(orgId, { projectId });
    },
    { revalidateOnFocus: false },
  );

  const states = useMemo<TrackerState[]>(() => {
    if (!swr.data?.items) return [];
    return swr.data.items
      .map(trackerStateFromApi)
      .sort(compareStatesForBoard);
  }, [swr.data]);

  return {
    states,
    total: swr.data?.total ?? 0,
    error: swr.error,
    isLoading: swr.isLoading,
    mutate: () => swr.mutate(),
  };
}
