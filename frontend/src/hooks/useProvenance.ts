"use client";

import useSWR from "swr";

import {
  provenanceApi,
  type ProvenanceEntityTypeApi,
} from "@/api/provenance.api";
import { mapProvenance, type Provenance } from "@/domain/provenance";

export function useProvenance(
  orgId: string | null | undefined,
  entityType: ProvenanceEntityTypeApi,
  entityId: string | null | undefined,
  enabled = true,
): {
  provenance: Provenance | null;
  isLoading: boolean;
  error: unknown;
} {
  const key =
    orgId && entityId && enabled
      ? (["provenance", orgId, entityType, entityId] as const)
      : null;

  const swr = useSWR(
    key,
    async () => {
      if (!orgId || !entityId) throw new Error("orgId/entityId required");
      return provenanceApi.resolve(orgId, entityType, entityId);
    },
    { revalidateOnFocus: false, keepPreviousData: true },
  );

  return {
    provenance: swr.data ? mapProvenance(swr.data) : null,
    isLoading: swr.isLoading,
    error: swr.error,
  };
}
