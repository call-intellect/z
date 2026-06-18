"use client";

import { useMemo } from "react";
import useSWR from "swr";

import { issuesApi } from "@/api/tracker/issues.api";
import { similarIssueFromApi, type SimilarIssue } from "@/domain/tracker";

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
    orgId && issueId
      ? (["tracker.issue.similar", orgId, issueId] as const)
      : null;

  const swr = useSWR(
    key,
    async () => {
      if (!orgId || !issueId) throw new Error("orgId/issueId required");
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
