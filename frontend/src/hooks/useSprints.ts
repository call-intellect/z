"use client";

import { useMemo } from "react";
import useSWR from "swr";

import { sprintsListApi, type ListSprintsRequest } from "@/api/sprints.api";
import { mapApiSprint, type DomainSprintListItem } from "@/domain/sprint";

export function useSprints(
  orgId: string | null | undefined,
  req: ListSprintsRequest = {},
): {
  sprints: DomainSprintListItem[];
  total: number;
  page: number;
  totalPages: number;
  limit: number;
  isLoading: boolean;
  error: unknown;
  mutate: () => Promise<unknown>;
} {
  const key = orgId
    ? [
        "sprints.list",
        orgId,
        req.status ?? "all",
        req.scopeKind ?? null,
        req.q ?? "",
        req.sortBy ?? "startDate",
        req.sortDir ?? "desc",
        req.page ?? 1,
        req.limit ?? 20,
      ]
    : null;

  const swr = useSWR(
    key,
    async () => {
      if (!orgId) throw new Error("orgId required");
      return sprintsListApi.list(orgId, req);
    },
    { revalidateOnFocus: false, keepPreviousData: true },
  );

  const sprints = useMemo<DomainSprintListItem[]>(
    () => (swr.data?.items ?? []).map(mapApiSprint),
    [swr.data],
  );

  return {
    sprints,
    total: swr.data?.total ?? 0,
    page: swr.data?.page ?? req.page ?? 1,
    totalPages: swr.data?.totalPages ?? 0,
    limit: swr.data?.limit ?? req.limit ?? 20,
    isLoading: swr.isLoading,
    error: swr.error,
    mutate: () => swr.mutate(),
  };
}
