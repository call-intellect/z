"use client";

import useSWR, { type KeyedMutator } from "swr";

import { supportApi } from "@/api/support.api";
import { toSupportMeta, type SupportMeta } from "@/domain/support";

export interface UseDeskMetaResult {
  data: SupportMeta | undefined;
  isLoading: boolean;
  error: unknown;
  mutate: KeyedMutator<SupportMeta>;
}

export function useDeskMeta(enabled = true): UseDeskMetaResult {
  const { data, error, isLoading, mutate } = useSWR(
    enabled ? "support-desk-meta" : null,
    () => supportApi.getDeskMeta().then(toSupportMeta),
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  );

  return { data, isLoading, error, mutate };
}
