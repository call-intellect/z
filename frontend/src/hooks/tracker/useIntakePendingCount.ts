"use client";

import useSWR from "swr";

import { intakeApi } from "@/api/tracker/intake.api";
import { BADGE_POLL_INTERVAL_MS, BADGE_DEDUPE_MS } from "@/lib/badge-polling";

export function useIntakePendingCount(
  orgId: string | null | undefined,
  enabled: boolean,
): {
  count: number;
  hasPending: boolean;
  isLoading: boolean;
  error: unknown;
} {
  const key =
    orgId && enabled ? (["tracker.intake.count", orgId] as const) : null;

  const swr = useSWR(
    key,
    async () => {
      if (!orgId) throw new Error("orgId required");
      return intakeApi.list(orgId, { status: "pending", limit: 1 });
    },
    {
      refreshInterval: BADGE_POLL_INTERVAL_MS,
      dedupingInterval: BADGE_DEDUPE_MS,
      revalidateOnFocus: true,
    },
  );

  const total = swr.data?.total ?? 0;

  return {
    count: total,
    hasPending: total > 0,
    isLoading: swr.isLoading,
    error: swr.error,
  };
}
