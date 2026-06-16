"use client";

import { useMemo } from "react";
import useSWR from "swr";

import { statesApi } from "@/api/tracker/states.api";
import {
  compareStatesForBoard,
  trackerStateFromApi,
  type TrackerState,
} from "@/domain/tracker";

export function useStates(
  orgId: string | null | undefined,
  projectId: string | null | undefined,
): {
  states: TrackerState[];
  total: number;
  error: unknown;
  isLoading: boolean;
  mutate: () => Promise<unknown>;
} {
  const key =
    orgId && projectId ? (["tracker.states", orgId, projectId] as const) : null;

  const swr = useSWR(
    key,
    async () => {
      if (!orgId || !projectId) throw new Error("orgId/projectId required");
      return statesApi.list(orgId, { projectId });
    },
    { revalidateOnFocus: false },
  );

  const states = useMemo<TrackerState[]>(() => {
    if (!swr.data?.items) return [];
    return swr.data.items.map(trackerStateFromApi).sort(compareStatesForBoard);
  }, [swr.data]);

  return {
    states,
    total: swr.data?.total ?? 0,
    error: swr.error,
    isLoading: swr.isLoading,
    mutate: () => swr.mutate(),
  };
}
