"use client";

import { useMemo } from "react";
import useSWR from "swr";

import { cyclesApi } from "@/api/tracker/cycles.api";
import { cycleFromApi, type Cycle } from "@/domain/tracker";

import { useTrackerLiveRefresh } from "./useTrackerLiveRefresh";

export function useCycles(
  orgId: string | null | undefined,
  projectId: string | null | undefined,
): {
  cycles: Cycle[];
  total: number;
  error: unknown;
  isLoading: boolean;
  mutate: () => Promise<unknown>;
} {
  const key = orgId && projectId ? ["tracker.cycles", orgId, projectId] : null;

  const swr = useSWR(
    key,
    async () => {
      if (!orgId || !projectId) throw new Error("orgId/projectId required");
      return cyclesApi.list(orgId, projectId);
    },
    { revalidateOnFocus: false },
  );

  useTrackerLiveRefresh(
    orgId,
    { projectId: projectId ?? null },
    Boolean(orgId && projectId),
  );

  const cycles = useMemo<Cycle[]>(
    () => (swr.data?.items ? swr.data.items.map(cycleFromApi) : []),
    [swr.data],
  );

  return {
    cycles,
    total: swr.data?.total ?? 0,
    error: swr.error,
    isLoading: swr.isLoading,
    mutate: () => swr.mutate(),
  };
}
