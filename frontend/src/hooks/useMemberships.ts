"use client";

import useSWR from "swr";

import { orgsApi, type OrgApi } from "@/api/orgs.api";

export type Membership = {
  id: string;
  name: string;
  slug: string;
  tier: OrgApi["tier"];
  isReferenceDemo: boolean;
};

export type UseMembershipsResult = {
  memberships: Membership[];
  isLoading: boolean;
  error: unknown;
};

const SWR_KEY = "/api/v1/orgs/me";

export function useMemberships(): UseMembershipsResult {
  const { data, error, isLoading } = useSWR(
    SWR_KEY,
    async () => {
      const res = await orgsApi.listMine();
      return res.orgs.map<Membership>((org) => ({
        id: org.id,
        name: org.name,
        slug: org.slug,
        tier: org.tier,
        isReferenceDemo: org.isReferenceDemo,
      }));
    },
    {
      revalidateOnFocus: false,
      shouldRetryOnError: false,
    },
  );

  return {
    memberships: data ?? [],
    isLoading,
    error,
  };
}
