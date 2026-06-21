"use client";

import type { FC } from "react";
import useSWR from "swr";

import { dashboardApi } from "@/api/dashboard.api";
import { useAuth } from "@/contexts/auth-context";
import { BusFactorWidget } from "@/ui/components/dashboard/BusFactorWidget";

import type { Rhythm } from "../types";

export const BusFactorCardWidget: FC<{ rhythm: Rhythm }> = () => {
  const { currentOrgId } = useAuth();

  const pulseSwr = useSWR(
    currentOrgId ? ["bus-factor-pulse", currentOrgId] : null,
    async () => dashboardApi.getPulsePatterns(currentOrgId!, "month"),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  const busFactor = pulseSwr.data?.busFactor ?? null;
  if (!pulseSwr.isLoading && !busFactor) return null;

  return (
    <BusFactorWidget
      data={busFactor}
      loading={pulseSwr.isLoading}
      error={null}
    />
  );
};
