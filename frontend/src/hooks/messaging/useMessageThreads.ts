"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";

import {
  messagingApi,
  type InboxSort,
  type InboxThreadType,
} from "@/api/messaging.api";
import { inboxThreadFromApi, type InboxThread } from "@/domain/messaging";

export interface UseMessageThreadsArgs {
  type: InboxThreadType;
  sort: InboxSort;
  q?: string | null;
}

export interface UseMessageThreadsResult {
  threads: InboxThread[];
  isLoading: boolean;
  error: unknown;
  hasMore: boolean;
  isLoadingMore: boolean;
  loadMore: () => void;
  mutate: () => Promise<unknown>;
}

export function useMessageThreads(
  orgId: string | null | undefined,
  args: UseMessageThreadsArgs,
): UseMessageThreadsResult {
  const { type, sort, q } = args;
  const normalizedQ = q && q.trim().length > 0 ? q.trim() : null;

  const key = useMemo(
    () =>
      orgId
        ? (["messaging.threads", orgId, type, sort, normalizedQ ?? ""] as const)
        : null,
    [orgId, type, sort, normalizedQ],
  );

  const swr = useSWR(
    key,
    async () => {
      if (!orgId) throw new Error("orgId required");
      return messagingApi.listThreads(orgId, {
        type,
        sort,
        q: normalizedQ,
      });
    },
    { revalidateOnFocus: false },
  );

  const [extraThreads, setExtraThreads] = useState<InboxThread[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const seedRef = useRef<string>("");

  useEffect(() => {
    setExtraThreads([]);
    setNextCursor(swr.data?.nextCursor ?? null);
    seedRef.current = key ? key.join("|") : "";
  }, [swr.data, key]);

  const loadMore = useCallback(() => {
    if (!orgId || !nextCursor || isLoadingMore) return;
    setIsLoadingMore(true);
    void messagingApi
      .listThreads(orgId, { type, sort, q: normalizedQ, cursor: nextCursor })
      .then((res) => {
        setExtraThreads((prev) => [
          ...prev,
          ...res.items.map(inboxThreadFromApi),
        ]);
        setNextCursor(res.nextCursor);
      })
      .catch(() => {})
      .finally(() => setIsLoadingMore(false));
  }, [orgId, nextCursor, isLoadingMore, type, sort, normalizedQ]);

  const threads = useMemo<InboxThread[]>(() => {
    const base = swr.data ? swr.data.items.map(inboxThreadFromApi) : [];
    const seen = new Set(base.map((t) => t.refId));
    const tail = extraThreads.filter((t) => !seen.has(t.refId));
    return [...base, ...tail];
  }, [swr.data, extraThreads]);

  return {
    threads,
    isLoading: swr.isLoading,
    error: swr.error,
    hasMore: nextCursor !== null,
    isLoadingMore,
    loadMore,
    mutate: () => swr.mutate(),
  };
}
