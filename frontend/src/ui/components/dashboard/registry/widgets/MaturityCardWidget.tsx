"use client";

import type { FC } from "react";
import { Gauge } from "lucide-react";
import useSWR from "swr";

import { operationsDashboardApi } from "@/api/operations-dashboard.api";
import { useAuth } from "@/contexts/auth-context";
import { fromMaturitySnapshotApi } from "@/domain/operations-dashboard";
import {
  CardTitle,
  GlassCard,
  GRAD,
} from "@/ui/components/dashboard/modern";
import { Skeleton } from "@/ui/shadcn/skeleton";

import { MaturityWidget } from "@app/(authenticated)/dashboard/operations/widgets/MaturityWidget";

import type { Rhythm } from "../types";

export const MaturityCardWidget: FC<{ rhythm: Rhythm }> = () => {
  const { currentOrgId } = useAuth();

  const overviewSwr = useSWR(
    currentOrgId ? ["maturity-overview", currentOrgId] : null,
    async () => operationsDashboardApi.getOverview(),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  if (overviewSwr.isLoading) {
    return (
      <GlassCard>
        <CardTitle icon={<Gauge size={16} />} grad={GRAD.teal}>
          Зрелость компании
        </CardTitle>
        <Skeleton className="mt-4 h-40" />
      </GlassCard>
    );
  }

  const overview = overviewSwr.data;
  if (!overview) return null;

  const maturity = fromMaturitySnapshotApi(overview.maturity);
  return <MaturityWidget maturity={maturity} />;
};
