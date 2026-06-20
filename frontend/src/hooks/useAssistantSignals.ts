"use client";

import { useCallback, useMemo } from "react";
import useSWR from "swr";

import { proactiveApi } from "@/api/proactive.api";
import { activityFeedApi } from "@/api/activity-feed.api";
import {
  mapProactiveToBellRow,
  mapSignalToBellRow,
  type BellRow,
} from "@/domain/assistant-signals";
import { BADGE_POLL_INTERVAL_MS, BADGE_DEDUPE_MS } from "@/lib/badge-polling";

export function useAssistantSignals(
  orgId: string | null | undefined,
  enabled = true,
): {
  proactiveRows: BellRow[];
  signalRows: BellRow[];
  signalsCount: number;
  hasUrgentSignal: boolean;
  isLoading: boolean;
  error: unknown;
  mutate: () => Promise<unknown>;
  dismiss: (id: string) => Promise<void>;
} {
  const key =
    orgId && enabled ? (["assistant-signals", orgId] as const) : null;

  const swr = useSWR(
    key,
    async () => {
      if (!orgId) throw new Error("orgId required");
      const [proactive, feed] = await Promise.all([
        proactiveApi.list(orgId, { limit: 20 }),
        activityFeedApi.list({
          feedType: "insight",
          status: "emitted",
          limit: 20,
        }),
      ]);
      return { proactive, feed };
    },
    {
      refreshInterval: BADGE_POLL_INTERVAL_MS,
      dedupingInterval: BADGE_DEDUPE_MS,
      revalidateOnFocus: true,
      keepPreviousData: true,
    },
  );

  const proactiveRows = useMemo<BellRow[]>(
    () =>
      (swr.data?.proactive.items ?? [])
        .filter((it) => it.dismissedAt == null)
        .map(mapProactiveToBellRow)
        .filter((row): row is BellRow => row !== null),
    [swr.data],
  );

  const signalRows = useMemo<BellRow[]>(
    () =>
      (swr.data?.feed.items ?? [])
        .filter((it) => it.severity === "critical" || it.severity === "high")
        .map(mapSignalToBellRow)
        .filter((row): row is BellRow => row !== null),
    [swr.data],
  );

  const dismiss = useCallback(
    async (id: string) => {
      if (!orgId) throw new Error("orgId required");
      await proactiveApi.dismiss(orgId, id);
      await swr.mutate();
    },
    [orgId, swr],
  );

  return {
    proactiveRows,
    signalRows,
    signalsCount: proactiveRows.length + signalRows.length,
    hasUrgentSignal: [...proactiveRows, ...signalRows].some(
      (row) => row.severity === "urgent",
    ),
    isLoading: swr.isLoading,
    error: swr.error,
    mutate: () => swr.mutate(),
    dismiss,
  };
}
