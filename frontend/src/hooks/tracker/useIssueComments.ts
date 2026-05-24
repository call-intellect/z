'use client';

import { useMemo } from 'react';
import useSWR from 'swr';

import { commentsApi } from '@/api/tracker/comments.api';
import { commentFromApi, type Comment } from '@/domain/tracker';

export function useIssueComments(
  orgId: string | null | undefined,
  issueId: string | null | undefined,
): {
  comments: Comment[];
  error: unknown;
  isLoading: boolean;
  mutate: () => Promise<unknown>;
} {
  const key =
    orgId && issueId ? ['tracker.issue.comments', orgId, issueId] : null;

  const swr = useSWR(
    key,
    async () => {
      if (!orgId || !issueId) throw new Error('orgId/issueId required');
      return commentsApi.listByIssue(orgId, issueId);
    },
    { revalidateOnFocus: false },
  );

  const comments = useMemo<Comment[]>(
    () => (swr.data ? swr.data.map(commentFromApi) : []),
    [swr.data],
  );

  return {
    comments,
    error: swr.error,
    isLoading: swr.isLoading,
    mutate: () => swr.mutate(),
  };
}
