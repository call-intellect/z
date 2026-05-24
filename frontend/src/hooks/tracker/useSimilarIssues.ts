'use client';

/**
 * useSimilarIssues — KNN-похожие задачи для данной задачи. Используется в
 * блоке «Похожие задачи (закрытые)» на странице `/issues/[id]`.
 *
 * Backend: `GET /api/v1/tracker/issues/:id/similar` (Phase 3, Sprint 6).
 * Возвращает массив `SimilarIssueDto[]` — отсортирован по similarity desc,
 * threshold/limit заданы серверной стороной (по умолчанию similarity ≥ 0.82).
 *
 * Revalidate-on-focus включён, чтобы при возвращении на вкладку обновлять
 * список — пользователь мог закрыть похожую задачу в другой вкладке.
 */

import { useMemo } from 'react';
import useSWR from 'swr';

import { issuesApi } from '@/api/tracker/issues.api';
import { similarIssueFromApi, type SimilarIssue } from '@/domain/tracker';

export function useSimilarIssues(
  orgId: string | null | undefined,
  issueId: string | null | undefined,
): {
  similar: SimilarIssue[];
  error: unknown;
  isLoading: boolean;
  mutate: () => Promise<unknown>;
} {
  const key =
    orgId && issueId ? (['tracker.issue.similar', orgId, issueId] as const) : null;

  const swr = useSWR(
    key,
    async () => {
      if (!orgId || !issueId) throw new Error('orgId/issueId required');
      return issuesApi.getSimilar(orgId, issueId);
    },
    { revalidateOnFocus: true },
  );

  const similar = useMemo<SimilarIssue[]>(
    () => (swr.data ? swr.data.map(similarIssueFromApi) : []),
    [swr.data],
  );

  return {
    similar,
    error: swr.error,
    isLoading: swr.isLoading,
    mutate: () => swr.mutate(),
  };
}
