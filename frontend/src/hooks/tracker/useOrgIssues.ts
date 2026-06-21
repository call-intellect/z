'use client';

/**
 * useOrgIssues — сквозной список задач всей организации (рабочий стол
 * «Задачи»). Источник: `GET /api/v1/issues` (page/limit-пагинация, видимость
 * по роли/visibilityMode на сервере). Контракт:
 *   - backend/src/modules/tracker/controllers/org-issues.controller.ts
 *
 * Ключ SWR начинается с 'tracker.issues' (с дискриминатором 'org' на 2-й
 * позиции), чтобы существующий useTrackerLiveRefresh (точное совпадение
 * key[0]==='tracker.issues') ре-валидировал доску на любые issue.*-события.
 */

import { useMemo } from 'react';
import useSWR from 'swr';

import {
  issuesApi,
  type ListOrgIssuesRequest,
} from '@/api/tracker/issues.api';
import {
  issueFromApi,
  type Issue,
  type ListIssuesResponseApi,
} from '@/domain/tracker';

import { useTrackerLiveRefresh } from './useTrackerLiveRefresh';

export interface UseOrgIssuesResult {
  issues: Issue[];
  total: number;
  page: number;
  limit: number;
  error: unknown;
  isLoading: boolean;
  mutate: () => Promise<unknown>;
}

export function useOrgIssues(
  orgId: string | null | undefined,
  req: ListOrgIssuesRequest = {},
): UseOrgIssuesResult {
  const key = orgId
    ? ([
        'tracker.issues',
        'org',
        orgId,
        req.projectId ?? null,
        req.assigneeUserId ?? null,
        req.stateCategory ?? null,
        req.priority ?? null,
        req.cycleId ?? null,
        req.labelId ?? null,
        req.q ?? null,
        req.includeArchived ?? false,
        req.includeDeleted ?? false,
        req.includeChildrenCount ?? false,
        req.includeEngagementCount ?? false,
        req.page ?? 1,
        req.limit ?? 100,
      ] as const)
    : null;

  const swr = useSWR<ListIssuesResponseApi>(
    key,
    async () => {
      if (!orgId) throw new Error('orgId required');
      return issuesApi.listOrg(orgId, req);
    },
    { revalidateOnFocus: false },
  );

  // Live-обновление: issue.* в этой организации (точное совпадение
  // key[0]==='tracker.issues' → SWR ре-валидирует наш ключ тоже).
  useTrackerLiveRefresh(orgId, {}, Boolean(orgId));

  const issues = useMemo<Issue[]>(
    () => (swr.data?.items ?? []).map(issueFromApi),
    [swr.data],
  );

  return {
    issues,
    total: swr.data?.total ?? 0,
    page: swr.data?.page ?? (req.page ?? 1),
    limit: swr.data?.limit ?? (req.limit ?? 100),
    error: swr.error,
    isLoading: swr.isLoading,
    mutate: () => swr.mutate(),
  };
}
