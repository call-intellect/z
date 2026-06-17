"use client";

import useSWR from "swr";

import { pendingActionsApi } from "@/api/pending-actions.api";
import {
  mapPendingActionsCount,
  type PendingActionsCount,
} from "@/domain/pending-action";
import { BADGE_POLL_INTERVAL_MS, BADGE_DEDUPE_MS } from "@/lib/badge-polling";

export function usePendingActionsCount(
  orgId: string | null | undefined,
  enabled = true,
): {
  total: number;
  bySource: PendingActionsCount["bySource"];
  hasUrgent: boolean;
  isLoading: boolean;
  error: unknown;
  mutate: () => Promise<unknown>;
} {
  const key =
    orgId && enabled ? (["pending-actions.count", orgId] as const) : null;

  const swr = useSWR(
    key,
    async () => {
      if (!orgId) throw new Error("orgId required");
      const dto = await pendingActionsApi.count(orgId);
      return mapPendingActionsCount(dto);
    },
    {
      refreshInterval: BADGE_POLL_INTERVAL_MS,
      dedupingInterval: BADGE_DEDUPE_MS,
      revalidateOnFocus: true,
    },
  );

  const bySource = swr.data?.bySource ?? {
    curation: 0,
    conflict: 0,
    intake: 0,
    probe: 0,
  };

  return {
    total: swr.data?.total ?? 0,
    bySource,
    hasUrgent: bySource.conflict > 0,
    isLoading: swr.isLoading,
    error: swr.error,
    mutate: () => swr.mutate(),
  };
}
