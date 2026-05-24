'use client';

import { useMemo } from 'react';
import useSWR from 'swr';

import { issuesApi } from '@/api/tracker/issues.api';
import {
  issueActivityFromApi,
  issueFromApi,
  type Issue,
  type IssueActivity,
} from '@/domain/tracker';

/** Одна задача по ID. */
export function useIssue(
  orgId: string | null | undefined,
  issueId: string | null | undefined,
): {
  issue: Issue | null;
  error: unknown;
  isLoading: boolean;
  mutate: () => Promise<unknown>;
} {
  const key = orgId && issueId ? ['tracker.issue', orgId, issueId] : null;

  const swr = useSWR(
    key,
    async () => {
      if (!orgId || !issueId) throw new Error('orgId/issueId required');
      return issuesApi.get(orgId, issueId);
    },
    { revalidateOnFocus: false },
  );

  const issue = useMemo<Issue | null>(
    () => (swr.data ? issueFromApi(swr.data) : null),
    [swr.data],
  );

  return {
    issue,
    error: swr.error,
    isLoading: swr.isLoading,
    mutate: () => swr.mutate(),
  };
}

/** Лента активности задачи. */
export function useIssueActivity(
  orgId: string | null | undefined,
  issueId: string | null | undefined,
): {
  activity: IssueActivity[];
  error: unknown;
  isLoading: boolean;
  mutate: () => Promise<unknown>;
} {
  const key =
    orgId && issueId ? ['tracker.issue.activity', orgId, issueId] : null;

  const swr = useSWR(
    key,
    async () => {
      if (!orgId || !issueId) throw new Error('orgId/issueId required');
      return issuesApi.activity(orgId, issueId);
    },
    { revalidateOnFocus: false },
  );

  const activity = useMemo<IssueActivity[]>(
    () => (swr.data ? swr.data.map(issueActivityFromApi) : []),
    [swr.data],
  );

  return {
    activity,
    error: swr.error,
    isLoading: swr.isLoading,
    mutate: () => swr.mutate(),
  };
}
