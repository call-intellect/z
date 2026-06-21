"use client";

import type { FC } from "react";
import { Gem } from "lucide-react";
import useSWR from "swr";

import { dashboardApi } from "@/api/dashboard.api";
import { directorDashboardFromApi } from "@/domain/director-dashboard";
import { useAuth } from "@/contexts/auth-context";
import {
  CardTitle,
  GlassCard,
  GRAD,
} from "@/ui/components/dashboard/modern";
import { ValueStripWidget } from "@app/(authenticated)/dashboard/widgets/ValueStripWidget";
import { Skeleton } from "@/ui/shadcn/skeleton";

import type { Rhythm } from "../types";

export const ValueWidget: FC<{ rhythm: Rhythm }> = ({ rhythm }) => {
  const { currentOrgId } = useAuth();
  const period = rhythm === "week" ? "week" : "month";

  const swr = useSWR(
    currentOrgId ? ["value-director", currentOrgId, period] : null,
    async () =>
      directorDashboardFromApi(
        await dashboardApi.getDirectorView(currentOrgId!, period),
      ),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  if (swr.isLoading) {
    return (
      <GlassCard>
        <CardTitle icon={<Gem size={16} />} grad={GRAD.violet}>
          Польза Коры за период
        </CardTitle>
        <Skeleton className="mt-4 h-28" />
      </GlassCard>
    );
  }

  const valueStrip = swr.data?.valueStrip;
  if (!valueStrip) return null;

  return (
    <GlassCard>
      <CardTitle icon={<Gem size={16} />} grad={GRAD.violet}>
        Польза Коры за период
      </CardTitle>
      <div className="mt-4">
        <ValueStripWidget data={valueStrip} />
      </div>
    </GlassCard>
  );
};
