"use client";

import { useMemo } from "react";
import useSWR from "swr";

import { worklogsApi } from "@/api/tracker/worklogs.api";
import { worklogFromApi, type Worklog } from "@/domain/tracker";

export function useWorklogs(
  orgId: string | null | undefined,
  issueId: string | null | undefined,
  enabled: boolean,
): {
  worklogs: Worklog[];
  totalMinutes: number;
  error: unknown;
  isLoading: boolean;
  mutate: () => Promise<unknown>;
} {
  const key =
    enabled && orgId && issueId
      ? ["tracker.issue.worklogs", orgId, issueId]
      : null;

  const swr = useSWR(
    key,
    async () => {
      if (!orgId || !issueId) throw new Error("orgId/issueId required");
      return worklogsApi.list(orgId, issueId);
    },
    { revalidateOnFocus: false },
  );

  const worklogs = useMemo<Worklog[]>(
    () => (swr.data ? swr.data.items.map(worklogFromApi) : []),
    [swr.data],
  );

  return {
    worklogs,
    totalMinutes: swr.data?.totalMinutes ?? 0,
    error: swr.error,
    isLoading: swr.isLoading,
    mutate: () => swr.mutate(),
  };
}
