"use client";

import { useMemo } from "react";
import useSWR from "swr";

import { operationsDailyDigestApi } from "@/api/operations-daily-digest.api";
import {
  executionDashboardApi,
  type StuckIssueRowApi,
} from "@/api/execution-dashboard.api";
import {
  fromDailyDigestApi,
  type DailyDigestDomain,
} from "@/domain/operations-daily-digest";

export function useDayCompanyDigest(orgId: string | null): {
  digest: DailyDigestDomain | null;
  isLoading: boolean;
  error: unknown;
  mutate: () => Promise<unknown>;
} {
  const key = orgId ? ["day-company.digest", orgId] : null;

  const swr = useSWR(
    key,
    async () => {
      const dto = await operationsDailyDigestApi.getLatest();
      return dto ? fromDailyDigestApi(dto) : null;
    },
    { revalidateOnFocus: false },
  );

  return {
    digest: swr.data ?? null,
    isLoading: swr.isLoading,
    error: swr.error,
    mutate: () => swr.mutate(),
  };
}

export function useStaleTasksCrossProject(orgId: string | null): {
  items: StuckIssueRowApi[];
  isLoading: boolean;
  error: unknown;
} {
  const key = orgId ? ["day-company.stuck", orgId] : null;

  const swr = useSWR(
    key,
    async () => {
      if (!orgId) throw new Error("Не указана организация");
      return executionDashboardApi.stuckCrossProject(orgId);
    },
    { revalidateOnFocus: false },
  );

  const items = useMemo(() => swr.data?.items ?? [], [swr.data]);

  return {
    items,
    isLoading: swr.isLoading,
    error: swr.error,
  };
}
