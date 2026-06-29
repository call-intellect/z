"use client";

import { useMemo } from "react";
import useSWR from "swr";

import { operationsDailyDigestApi } from "@/api/operations-daily-digest.api";
import type { AvailablePeriodApi } from "@/api/available-periods.api";
import {
  executionDashboardApi,
  type StuckIssueRowApi,
} from "@/api/execution-dashboard.api";
import {
  fromDailyDigestApi,
  type DailyDigestDomain,
} from "@/domain/operations-daily-digest";

export function useDayCompanyDigest(
  orgId: string | null,
  period: string | null,
): {
  digest: DailyDigestDomain | null;
  isLoading: boolean;
  error: unknown;
  mutate: () => Promise<unknown>;
} {
  const key = orgId
    ? ["day-company.digest", orgId, period ?? "__latest__"]
    : null;

  const swr = useSWR(
    key,
    async () => {
      const dto = period
        ? await operationsDailyDigestApi.getByDate(period)
        : await operationsDailyDigestApi.getLatest();
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

export function useDayAvailablePeriods(orgId: string | null): {
  periods: AvailablePeriodApi[];
  latest: string | null;
  isLoading: boolean;
  error: unknown;
} {
  const key = orgId ? ["day-company.available", orgId] : null;

  const swr = useSWR(
    key,
    async () => {
      try {
        return await operationsDailyDigestApi.availablePeriods();
      } catch {
        return { rhythm: "day" as const, periods: [], latest: null };
      }
    },
    { revalidateOnFocus: false },
  );

  return {
    periods: swr.data?.periods ?? [],
    latest: swr.data?.latest ?? null,
    isLoading: swr.isLoading,
    error: swr.error,
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
