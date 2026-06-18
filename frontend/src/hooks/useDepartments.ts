"use client";

import { useMemo } from "react";
import useSWR from "swr";

import { departmentsApi, type DepartmentApi } from "@/api/structure.api";

export function useDepartments(orgId: string | null | undefined): {
  departments: DepartmentApi[];
  isLoading: boolean;
  error: unknown;
  mutate: () => Promise<unknown>;
} {
  const key = orgId ? ["departments.list", orgId] : null;

  const swr = useSWR(
    key,
    async () => {
      if (!orgId) throw new Error("orgId required");
      return departmentsApi.list(orgId);
    },
    { revalidateOnFocus: false },
  );

  const departments = useMemo(() => swr.data?.items ?? [], [swr.data]);

  return {
    departments,
    isLoading: swr.isLoading,
    error: swr.error,
    mutate: () => swr.mutate(),
  };
}
