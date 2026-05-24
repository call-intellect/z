'use client';

import { useMemo } from 'react';
import useSWR, { type KeyedMutator } from 'swr';

import {
  issuesApi,
  type ListIssuesRequest,
} from '@/api/tracker/issues.api';
import {
  issueFromApi,
  type Issue,
  type ListIssuesResponseApi,
} from '@/domain/tracker';

import { useTrackerLiveRefresh } from './useTrackerLiveRefresh';

/**
 * Список задач проекта с фильтрами state/assignee/label/cycle/goal/priority.
 *
 * Подписывается на live-события трекера (issue.*, intake.triaged) через
 * `useTrackerLiveRefresh` — на любое событие нужного типа SWR ре-валидирует
 * этот список.
 */
export function useIssues(
  orgId: string | null | undefined,
  projectId: string | null | undefined,
  req: ListIssuesRequest = {},
): {
  issues: Issue[];
  total: number;
  page: number;
  limit: number;
  error: unknown;
  isLoading: boolean;
  /**
   * Полная SWR-`mutate` для этого ключа — поддерживает optimistic update,
   * rollback и кастомный fetcher. Сигнатура совпадает с `KeyedMutator`
   * SWR — это нужно `Board.tsx` для drag-and-drop transition.
   */
  mutate: KeyedMutator<ListIssuesResponseApi>;
} {
  const key =
    orgId && projectId
      ? [
          'tracker.issues',
          orgId,
          projectId,
          req.stateId ?? null,
          req.stateCategory ?? null,
          req.assigneeUserId ?? null,
          req.labelId ?? null,
          req.cycleId ?? null,
          req.goalId ?? null,
          req.priority ?? null,
          req.parentId ?? null,
          req.includeArchived ?? false,
          req.includeDeleted ?? false,
          req.q ?? '',
          req.page ?? 1,
          req.limit ?? 50,
        ]
      : null;

  const swr = useSWR(
    key,
    async () => {
      if (!orgId || !projectId) throw new Error('orgId/projectId required');
      return issuesApi.list(orgId, projectId, req);
    },
    { revalidateOnFocus: false },
  );

  // Live-обновление: подписка на issue.* и intake.triaged. Project room
  // прицельно — чтобы получать только события своего проекта.
  useTrackerLiveRefresh(orgId, { projectId: projectId ?? null }, Boolean(orgId && projectId));

  const issues = useMemo<Issue[]>(
    () => (swr.data?.items ? swr.data.items.map(issueFromApi) : []),
    [swr.data],
  );

  return {
    issues,
    total: swr.data?.total ?? 0,
    page: swr.data?.page ?? 1,
    limit: swr.data?.limit ?? 50,
    error: swr.error,
    isLoading: swr.isLoading,
    mutate: swr.mutate,
  };
}
