"use client";

import useSWR from "swr";

import { monthlyDigestApi } from "@/api/monthly-digest.api";
import {
  fromMonthlyDigestApi,
  type MonthlyDigestDomain,
} from "@/domain/operations-monthly-digest";

export function useMonthCompanyDigest(orgId: string | null): {
  digest: MonthlyDigestDomain | null;
  isLoading: boolean;
  error: unknown;
  mutate: () => Promise<unknown>;
} {
  const key = orgId ? ["month-company.digest", orgId] : null;

  const swr = useSWR(
    key,
    async () => {
      const dto = await monthlyDigestApi.getLatest();
      return dto ? fromMonthlyDigestApi(dto) : null;
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
