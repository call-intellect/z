"use client";

import { useMemo } from "react";
import useSWR from "swr";

import { messagingApi } from "@/api/messaging.api";
import { BADGE_DEDUPE_MS, BADGE_POLL_INTERVAL_MS } from "@/lib/badge-polling";

export interface UseUnreadMessageCountResult {
  total: number;
  hasUnread: boolean;
  isLoading: boolean;
  error: unknown;
  mutate: () => Promise<unknown>;
}

export function useUnreadMessageCount(
  orgId: string | null | undefined,
): UseUnreadMessageCountResult {
  const key = orgId ? (["messaging.unread.count", orgId] as const) : null;

  const swr = useSWR(
    key,
    async () => {
      if (!orgId) throw new Error("orgId required");
      return messagingApi.unreadCount(orgId);
    },
    {
      revalidateOnFocus: true,
      dedupingInterval: BADGE_DEDUPE_MS,
      refreshInterval: BADGE_POLL_INTERVAL_MS,
    },
  );

  const total = useMemo(() => swr.data?.total ?? 0, [swr.data]);

  return {
    total,
    hasUnread: total > 0,
    isLoading: swr.isLoading,
    error: swr.error,
    mutate: () => swr.mutate(),
  };
}
