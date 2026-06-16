"use client";

import { useMemo } from "react";
import useSWR from "swr";

import {
  personsDomainApi,
  type ListPersonsQuery,
  type PersonDomainApi,
} from "@/api/structure.api";

export function usePersons(
  orgId: string | null | undefined,
  query: ListPersonsQuery = {},
): {
  persons: PersonDomainApi[];
  isLoading: boolean;
  error: unknown;
  mutate: () => Promise<unknown>;
} {
  const key = orgId
    ? [
        "persons.list",
        orgId,
        query.roleId ?? null,
        query.departmentId ?? null,
        query.invitationStatus ?? null,
      ]
    : null;

  const swr = useSWR(
    key,
    async () => {
      if (!orgId) throw new Error("orgId required");
      return personsDomainApi.list(orgId, query);
    },
    { revalidateOnFocus: false },
  );

  const persons = useMemo(() => swr.data?.items ?? [], [swr.data]);

  return {
    persons,
    isLoading: swr.isLoading,
    error: swr.error,
    mutate: () => swr.mutate(),
  };
}
