"use client";

import { useMemo } from "react";
import useSWR, { type KeyedMutator } from "swr";

import { issuesApi, type ListIssuesRequest } from "@/api/tracker/issues.api";
import {
  issueFromApi,
  type Issue,
  type ListIssuesResponseApi,
} from "@/domain/tracker";

import { useTrackerLiveRefresh } from "./useTrackerLiveRefresh";

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
  mutate: KeyedMutator<ListIssuesResponseApi>;
} {
  const key =
    orgId && projectId
      ? [
          "tracker.issues",
          orgId,
          projectId,
          req.stateId ?? null,
          req.stateCategory ?? null,
          req.assigneeUserId ?? null,
          req.labelId ?? null,
          req.cycleId ?? null,
          req.goalId ?? null,
          req.boardId ?? null,
          req.priority ?? null,
          req.parentId ?? null,
          req.includeArchived ?? false,
          req.includeDeleted ?? false,
          req.includeChildrenCount ?? false,
          req.q ?? "",
          req.page ?? 1,
          req.limit ?? 50,
        ]
      : null;

  const swr = useSWR(
    key,
    async () => {
      if (!orgId || !projectId) throw new Error("orgId/projectId required");
      return issuesApi.list(orgId, projectId, req);
    },
    { revalidateOnFocus: false },
  );

  useTrackerLiveRefresh(
    orgId,
    { projectId: projectId ?? null },
    Boolean(orgId && projectId),
  );

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
