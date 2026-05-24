'use client';

import { useMemo } from 'react';
import useSWR from 'swr';

import { issuesApi } from '@/api/tracker/issues.api';
import { issueRelationFromApi, type IssueRelation } from '@/domain/tracker';

export function useIssueRelations(
  orgId: string | null | undefined,
  issueId: string | null | undefined,
): {
  relations: IssueRelation[];
  error: unknown;
  isLoading: boolean;
  mutate: () => Promise<unknown>;
} {
  const key =
    orgId && issueId ? ['tracker.issue.relations', orgId, issueId] : null;

  const swr = useSWR(
    key,
    async () => {
      if (!orgId || !issueId) throw new Error('orgId/issueId required');
      return issuesApi.listRelations(orgId, issueId);
    },
    { revalidateOnFocus: false },
  );

  const relations = useMemo<IssueRelation[]>(
    () => (swr.data ? swr.data.map(issueRelationFromApi) : []),
    [swr.data],
  );

  return {
    relations,
    error: swr.error,
    isLoading: swr.isLoading,
    mutate: () => swr.mutate(),
  };
}
