'use client';

import { useMemo } from 'react';
import useSWR from 'swr';

import { checklistsApi } from '@/api/tracker/checklists.api';
import { checklistFromApi, type Checklist } from '@/domain/tracker';

/**
 * Список чек-листов задачи (2026-05-27). SWR-ключ
 * `['tracker.issue.checklists', orgId, issueId]`.
 *
 * WS-события (`checklist.*`, `checklist_item.*`, `issue.checklist_progress_changed`)
 * автоинвалидируют этот кэш через `useTrackerLiveRefresh` в компоненте.
 */
export function useIssueChecklists(
  orgId: string | null | undefined,
  issueId: string | null | undefined,
): {
  checklists: Checklist[];
  error: unknown;
  isLoading: boolean;
  mutate: () => Promise<unknown>;
} {
  const key =
    orgId && issueId ? ['tracker.issue.checklists', orgId, issueId] : null;

  const swr = useSWR(
    key,
    async () => {
      if (!orgId || !issueId) throw new Error('orgId/issueId required');
      return checklistsApi.listByIssue(orgId, issueId);
    },
    { revalidateOnFocus: false },
  );

  const checklists = useMemo<Checklist[]>(
    () => (swr.data ? swr.data.map(checklistFromApi) : []),
    [swr.data],
  );

  return {
    checklists,
    error: swr.error,
    isLoading: swr.isLoading,
    mutate: () => swr.mutate(),
  };
}
