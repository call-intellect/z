"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";

import { issuesApi, type MyInboxRequest } from "@/api/tracker/issues.api";
import {
  issueFromApi,
  type Issue,
  type IssueApi,
  type MyInboxResponseApi,
} from "@/domain/tracker";

import { useTrackerLiveRefresh } from "./useTrackerLiveRefresh";

export interface UseMyInboxResult {
  issues: Issue[];
  nextCursor: string | null;
  hasMore: boolean;
  limit: number;
  error: unknown;
  isLoading: boolean;
  isLoadingMore: boolean;
  loadMore: () => Promise<void>;
  mutate: () => Promise<unknown>;
}

export function useMyInbox(
  orgId: string | null | undefined,
  req: MyInboxRequest = {},
): UseMyInboxResult {
  const [extraItems, setExtraItems] = useState<IssueApi[]>([]);
  const [tailCursor, setTailCursor] = useState<string | null>(null);
  const [tailExhausted, setTailExhausted] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const loadInFlight = useRef(false);

  const key = orgId
    ? ([
        "me.inbox",
        orgId,
        req.stateCategory ?? null,
        req.stateId ?? null,
        req.priority ?? null,
        req.projectId ?? null,
        req.labelId ?? null,
        req.cycleId ?? null,
        req.dueBefore ?? null,
        req.dueAfter ?? null,
        req.includeArchived ?? false,
        req.includeDeleted ?? false,
        req.cursor ?? null,
        req.limit ?? 50,
      ] as const)
    : null;

  const swr = useSWR<MyInboxResponseApi>(
    key,
    async () => {
      if (!orgId) throw new Error("orgId required");
      return issuesApi.myInbox(orgId, req);
    },
    { revalidateOnFocus: false },
  );

  useEffect(() => {
    setExtraItems([]);
    setTailCursor(null);
    setTailExhausted(false);
  }, [swr.data]);

  useTrackerLiveRefresh(orgId, {}, Boolean(orgId));

  const firstPageCursor = swr.data?.nextCursor ?? null;

  const issues = useMemo<Issue[]>(() => {
    const firstPageItems = swr.data?.items ?? [];
    return [...firstPageItems, ...extraItems].map(issueFromApi);
  }, [swr.data, extraItems]);

  const effectiveNextCursor =
    extraItems.length > 0 ? tailCursor : firstPageCursor;
  const effectiveHasMore = tailExhausted ? false : effectiveNextCursor !== null;

  const loadMore = useCallback(async () => {
    if (!orgId) return;
    if (loadInFlight.current) return;
    if (!effectiveHasMore) return;
    if (!effectiveNextCursor) return;

    loadInFlight.current = true;
    setIsLoadingMore(true);
    try {
      const res = await issuesApi.myInbox(orgId, {
        ...req,
        cursor: effectiveNextCursor,
      });
      setExtraItems((prev) => [...prev, ...res.items]);
      setTailCursor(res.nextCursor);
      if (res.nextCursor === null) setTailExhausted(true);
    } finally {
      loadInFlight.current = false;
      setIsLoadingMore(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, effectiveHasMore, effectiveNextCursor, JSON.stringify(req)]);

  return {
    issues,
    nextCursor: effectiveNextCursor,
    hasMore: effectiveHasMore,
    limit: swr.data?.limit ?? req.limit ?? 50,
    error: swr.error,
    isLoading: swr.isLoading,
    isLoadingMore,
    loadMore,
    mutate: () => swr.mutate(),
  };
}
