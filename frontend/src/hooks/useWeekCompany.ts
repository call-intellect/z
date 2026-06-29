"use client";

import useSWR from "swr";

import { weeklyDigestApi } from "@/api/weekly-digest.api";
import { ApiError } from "@/api/api-error";
import type { AvailablePeriodApi } from "@/api/available-periods.api";
import {
  fromWeeklyDigestApi,
  type WeeklyDigestDomain,
} from "@/domain/operations-weekly-digest";

export function useWeekCompanyDigest(
  orgId: string | null,
  period: string | null,
): {
  digest: WeeklyDigestDomain | null;
  isLoading: boolean;
  error: unknown;
  mutate: () => Promise<unknown>;
} {
  const key = orgId
    ? ["week-company.digest", orgId, period ?? "__latest__"]
    : null;

  const swr = useSWR(
    key,
    async () => {
      if (!period) {
        const dto = await weeklyDigestApi.getLatest();
        return dto ? fromWeeklyDigestApi(dto) : null;
      }
      try {
        const dto = await weeklyDigestApi.get(period);
        return fromWeeklyDigestApi(dto);
      } catch (e) {
        if (e instanceof ApiError && e.code === "digest_not_found") {
          return null;
        }
        throw e;
      }
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

export function useWeekAvailablePeriods(orgId: string | null): {
  periods: AvailablePeriodApi[];
  latest: string | null;
  isLoading: boolean;
  error: unknown;
} {
  const key = orgId ? ["week-company.available", orgId] : null;

  const swr = useSWR(
    key,
    async () => {
      try {
        return await weeklyDigestApi.availablePeriods();
      } catch {
        return { rhythm: "week" as const, periods: [], latest: null };
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
