"use client";

import useSWR from "swr";
import { orgsApi, type OrgApi } from "@/api/orgs.api";

export function useOrgSetup(orgId: string | null) {
  const swr = useSWR<{ org: OrgApi }>(
    orgId ? ["orgs.setup", orgId] : null,
    () => orgsApi.byId(orgId!),
    { revalidateOnFocus: false },
  );

  const org = swr.data?.org ?? null;

  return {
    org,
    setupCompletedAt: org?.setupCompletedAt ?? null,
    isLoading: swr.isLoading,
    mutate: () => swr.mutate(),
  };
}
