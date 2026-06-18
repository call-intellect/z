"use client";

import { useMemo } from "react";
import useSWR from "swr";

import { issuesApi } from "@/api/tracker/issues.api";
import { BADGE_DEDUPE_MS } from "@/lib/badge-polling";

import { useTrackerLiveRefresh } from "./useTrackerLiveRefresh";

export interface UseMyInboxCountResult {
  count: number;
  total: number;
  unread: number;
  hasUnread: boolean;
  isLoading: boolean;
  error: unknown;
  mutate: () => Promise<unknown>;
}

export function useMyInboxCount(
  orgId: string | null | undefined,
): UseMyInboxCountResult {
  const key = orgId ? (["me.inbox.count", orgId] as const) : null;

  const swr = useSWR(
    key,
    async () => {
      if (!orgId) throw new Error("orgId required");
      return issuesApi.myInboxCount(orgId);
    },
    { revalidateOnFocus: true, dedupingInterval: BADGE_DEDUPE_MS },
  );

  useTrackerLiveRefresh(orgId, {}, Boolean(orgId));

  const { total, unread } = useMemo(() => {
    if (!swr.data) return { total: 0, unread: 0 };
    return { total: swr.data.total, unread: swr.data.unread };
  }, [swr.data]);

  return {
    count: total,
    total,
    unread,
    hasUnread: unread > 0,
    isLoading: swr.isLoading,
    error: swr.error,
    mutate: () => swr.mutate(),
  };
}
