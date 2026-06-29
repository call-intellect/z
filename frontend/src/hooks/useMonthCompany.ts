"use client";

import useSWR from "swr";

import { monthlyDigestApi } from "@/api/monthly-digest.api";
import { ApiError } from "@/api/api-error";
import type { AvailablePeriodApi } from "@/api/available-periods.api";
import {
  fromMonthlyDigestApi,
  type MonthlyDigestDomain,
} from "@/domain/operations-monthly-digest";

export function useMonthCompanyDigest(
  orgId: string | null,
  period: string | null,
): {
  digest: MonthlyDigestDomain | null;
  isLoading: boolean;
  error: unknown;
  mutate: () => Promise<unknown>;
} {
  const key = orgId
    ? ["month-company.digest", orgId, period ?? "__latest__"]
    : null;

  const swr = useSWR(
    key,
    async () => {
      if (!period) {
        const dto = await monthlyDigestApi.getLatest();
        return dto ? fromMonthlyDigestApi(dto) : null;
      }
      try {
        const dto = await monthlyDigestApi.get(period);
        return fromMonthlyDigestApi(dto);
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

export function useMonthAvailablePeriods(orgId: string | null): {
  periods: AvailablePeriodApi[];
  latest: string | null;
  isLoading: boolean;
  error: unknown;
} {
  const key = orgId ? ["month-company.available", orgId] : null;

  const swr = useSWR(
    key,
    async () => {
      try {
        return await monthlyDigestApi.availablePeriods();
      } catch {
        return { rhythm: "month" as const, periods: [], latest: null };
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
