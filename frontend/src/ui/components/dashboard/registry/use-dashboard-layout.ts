"use client";

import { useMemo } from "react";
import useSWR from "swr";

import { dashboardLayoutApi } from "@/api/dashboard-layout.api";
import { useAuth } from "@/contexts/auth-context";

import { DEFAULT_PRESETS } from "./presets";
import type { DashboardRole, Rhythm } from "./types";

export function useDashboardLayout(
  role: DashboardRole,
  rhythm: Rhythm,
): { layout: string[]; isLoading: boolean } {
  const { currentOrgId } = useAuth();
  const fallback = DEFAULT_PRESETS[role][rhythm];

  const key = currentOrgId
    ? ["dashboard.layout", currentOrgId, role, rhythm]
    : null;

  const swr = useSWR(
    key,
    async () => {
      if (!currentOrgId) throw new Error("orgId required");
      try {
        return await dashboardLayoutApi.getLayout(currentOrgId, role, rhythm);
      } catch {
        return { role, rhythm, layout: null } as const;
      }
    },
    {
      revalidateOnFocus: false,
      fallbackData: { role, rhythm, layout: null },
    },
  );

  const layout = useMemo<string[]>(
    () => swr.data?.layout ?? fallback,
    [swr.data, fallback],
  );

  return { layout, isLoading: swr.isLoading };
}
