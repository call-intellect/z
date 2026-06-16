"use client";

import { useMemo } from "react";
import useSWR from "swr";

import { vendorsApi, type VendorListItemApi } from "@/api/vendors.api";

export function useVendors(
  orgId: string | null | undefined,
  q?: string,
  limit: number = 20,
): {
  vendors: VendorListItemApi[];
  isLoading: boolean;
  error: unknown;
  mutate: () => Promise<unknown>;
} {
  const key = orgId ? ["vendors.list", orgId, q ?? "", limit] : null;

  const swr = useSWR(
    key,
    async () => {
      if (!orgId) throw new Error("orgId required");
      const filters = {
        limit,
        q: q && q.trim().length > 0 ? q.trim() : undefined,
      };
      return vendorsApi.list(filters, orgId);
    },
    { revalidateOnFocus: false, keepPreviousData: true },
  );

  const vendors = useMemo(() => swr.data?.items ?? [], [swr.data]);

  return {
    vendors,
    isLoading: swr.isLoading,
    error: swr.error,
    mutate: () => swr.mutate(),
  };
}
