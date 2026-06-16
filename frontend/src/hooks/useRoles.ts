"use client";

import { useMemo } from "react";
import useSWR from "swr";

import {
  rolesDomainApi,
  type ListRolesQuery,
  type RoleDomainApi,
} from "@/api/structure.api";

export function useRoles(
  orgId: string | null | undefined,
  query: ListRolesQuery = {},
): {
  roles: RoleDomainApi[];
  isLoading: boolean;
  error: unknown;
  mutate: () => Promise<unknown>;
} {
  const key = orgId ? ["roles.list", orgId, query.departmentId ?? null] : null;

  const swr = useSWR(
    key,
    async () => {
      if (!orgId) throw new Error("orgId required");
      return rolesDomainApi.list(orgId, query);
    },
    { revalidateOnFocus: false },
  );

  const roles = useMemo(() => swr.data?.items ?? [], [swr.data]);

  return {
    roles,
    isLoading: swr.isLoading,
    error: swr.error,
    mutate: () => swr.mutate(),
  };
}
