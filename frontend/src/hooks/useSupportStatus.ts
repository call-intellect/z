"use client";

import useSWR from "swr";

import { supportApi } from "@/api/support.api";
import { toSupportStatus, type SupportStatus } from "@/domain/support";

export interface UseSupportStatusResult {
  status: SupportStatus | undefined;
  deskEnabled: boolean;
  isAgent: boolean;
  isLoading: boolean;
  error: unknown;
  mutate: () => void;
}

export function useSupportStatus(): UseSupportStatusResult {
  const { data, error, isLoading, mutate } = useSWR(
    "support-status",
    () => supportApi.getStatus().then(toSupportStatus),
    { revalidateOnFocus: false },
  );

  return {
    status: data,
    deskEnabled: data?.deskEnabled ?? false,
    isAgent: data?.isAgent ?? false,
    isLoading,
    error,
    mutate: () => {
      void mutate();
    },
  };
}
