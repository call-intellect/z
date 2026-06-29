"use client";

import useSWR from "swr";

import { weeklyDigestApi } from "@/api/weekly-digest.api";
import {
  fromWeeklyDigestApi,
  type WeeklyDigestDomain,
} from "@/domain/operations-weekly-digest";

export function useWeekCompanyDigest(orgId: string | null): {
  digest: WeeklyDigestDomain | null;
  isLoading: boolean;
  error: unknown;
  mutate: () => Promise<unknown>;
} {
  const key = orgId ? ["week-company.digest", orgId] : null;

  const swr = useSWR(
    key,
    async () => {
      const dto = await weeklyDigestApi.getLatest();
      return dto ? fromWeeklyDigestApi(dto) : null;
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
