"use client";

import { useMemo } from "react";
import useSWR from "swr";

import { progressUpdatesApi } from "@/api/tracker/progress-updates.api";
import {
  progressUpdateFromApi,
  type ProgressUpdate,
} from "@/domain/tracker";

export function useProgressUpdates(
  orgId: string | null | undefined,
  issueId: string | null | undefined,
): {
  updates: ProgressUpdate[];
  error: unknown;
  isLoading: boolean;
  mutate: () => Promise<unknown>;
} {
  const key =
    orgId && issueId ? ["tracker.issue.progress-updates", orgId, issueId] : null;

  const swr = useSWR(
    key,
    async () => {
      if (!orgId || !issueId) throw new Error("orgId/issueId required");
      return progressUpdatesApi.list(orgId, issueId);
    },
    { revalidateOnFocus: false },
  );

  const updates = useMemo<ProgressUpdate[]>(
    () => (swr.data ? swr.data.map(progressUpdateFromApi) : []),
    [swr.data],
  );

  return {
    updates,
    error: swr.error,
    isLoading: swr.isLoading,
    mutate: () => swr.mutate(),
  };
}
