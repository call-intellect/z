'use client';

/**
 * useIssueChildren — список прямых детей (подзадач) задачи.
 *
 * Контракт: `GET /api/v1/issues/:id/children` —
 *   `backend/src/modules/tracker/controllers/issues.controller.ts#children`.
 *
 * Используется блоком `IssueSubtasks` в карточке родителя. При появлении
 * новой подзадачи / смене parentId / завершении подзадачи WS-событие
 * `issue.*` инвалидирует SWR-ключ `tracker.issue.children` (см.
 * `useTrackerLiveRefresh`).
 */

import { useMemo } from 'react';
import useSWR from 'swr';

import { issuesApi } from '@/api/tracker/issues.api';
import { issueChildFromApi, type IssueChild } from '@/domain/tracker';

import { useTrackerLiveRefresh } from './useTrackerLiveRefresh';

export function useIssueChildren(
  orgId: string | null | undefined,
  issueId: string | null | undefined,
): {
  children: IssueChild[];
  total: number;
  isLoading: boolean;
  error: unknown;
  mutate: () => Promise<unknown>;
} {
  const key =
    orgId && issueId ? ['tracker.issue.children', orgId, issueId] : null;

  const swr = useSWR(
    key,
    async () => {
      if (!orgId || !issueId) throw new Error('orgId/issueId required');
      return issuesApi.getChildren(orgId, issueId);
    },
    { revalidateOnFocus: false },
  );

  // Узкая подписка на issue room — при любом изменении задачи
  // (включая её детей) глобальный refresh покроет наш ключ.
  useTrackerLiveRefresh(orgId, { issueId: issueId ?? null }, Boolean(orgId && issueId));

  const children = useMemo<IssueChild[]>(
    () => (swr.data?.items ? swr.data.items.map(issueChildFromApi) : []),
    [swr.data],
  );

  return {
    children,
    total: swr.data?.total ?? 0,
    isLoading: swr.isLoading,
    error: swr.error,
    mutate: () => swr.mutate(),
  };
}
