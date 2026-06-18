"use client";

import { useMemo } from "react";
import useSWR from "swr";

import { issuesApi } from "@/api/tracker/issues.api";
import { issueChildFromApi, type IssueChild } from "@/domain/tracker";

import { useTrackerLiveRefresh } from "./useTrackerLiveRefresh";

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
    orgId && issueId ? ["tracker.issue.children", orgId, issueId] : null;

  const swr = useSWR(
    key,
    async () => {
      if (!orgId || !issueId) throw new Error("orgId/issueId required");
      return issuesApi.getChildren(orgId, issueId);
    },
    { revalidateOnFocus: false },
  );

  useTrackerLiveRefresh(
    orgId,
    { issueId: issueId ?? null },
    Boolean(orgId && issueId),
  );

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
