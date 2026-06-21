"use client";

import type { FC } from "react";
import { CheckCircle2, Clock } from "lucide-react";
import useSWR from "swr";

import { operationsDashboardApi } from "@/api/operations-dashboard.api";
import { useAuth } from "@/contexts/auth-context";
import {
  CardTitle,
  CHART,
  GlassCard,
  GRAD,
  StatCard,
} from "@/ui/components/dashboard/modern";
import { Skeleton } from "@/ui/shadcn/skeleton";

import type { Rhythm } from "../types";
import { SourceLink } from "../_kit";

function rangeForRhythm(rhythm: Rhythm): { from: string; to: string } {
  const today = new Date();
  const to = today.toISOString().slice(0, 10);
  if (rhythm === "today") return { from: to, to };
  const days = rhythm === "week" ? 7 : 30;
  const fromDate = new Date(today);
  fromDate.setDate(fromDate.getDate() - days);
  return { from: fromDate.toISOString().slice(0, 10), to };
}

export const DecisionsWidget: FC<{ rhythm: Rhythm }> = ({ rhythm }) => {
  const { currentOrgId } = useAuth();
  const range = rangeForRhythm(rhythm);

  const throughputSwr = useSWR(
    currentOrgId
      ? ["decisions-throughput", currentOrgId, range.from, range.to]
      : null,
    async () => operationsDashboardApi.getDecisionThroughput(range),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  const stalledSwr = useSWR(
    currentOrgId ? ["decisions-stalled", currentOrgId] : null,
    async () => operationsDashboardApi.getStalledDecisions(),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  if (throughputSwr.isLoading || stalledSwr.isLoading) {
    return (
      <GlassCard>
        <CardTitle icon={<CheckCircle2 size={16} />} grad={GRAD.teal}>
          Решения
        </CardTitle>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      </GlassCard>
    );
  }

  const throughput = throughputSwr.data;
  const stalled = stalledSwr.data?.items ?? [];
  const total = throughput?.total ?? 0;

  if (total === 0 && stalled.length === 0) return null;

  return (
    <GlassCard>
      <CardTitle icon={<CheckCircle2 size={16} />} grad={GRAD.teal}>
        Решения
      </CardTitle>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <StatCard
          icon={<CheckCircle2 size={18} />}
          grad={GRAD.teal}
          tone={CHART.teal}
          label={`Доведено: ${throughput?.doneWithOutcomes ?? 0} из ${total}`}
          value={`${throughput?.throughputPercent ?? 0}%`}
        />
        <StatCard
          icon={<Clock size={18} />}
          grad={GRAD.amber}
          tone={CHART.amber}
          label="Застряли без результата"
          value={String(stalled.length)}
        />
      </div>

      {stalled.length > 0 && (
        <div className="mt-4 space-y-2">
          {stalled.map((decision) => (
            <div
              key={decision.id}
              className="flex items-center gap-3 rounded-xl p-3"
              style={{ background: "var(--surface-inset)" }}
            >
              <span className="min-w-0 flex-1">
                <span
                  className="block truncate text-sm font-medium"
                  style={{ color: CHART.text }}
                >
                  {decision.statement}
                </span>
                <span
                  className="mt-0.5 block text-xs"
                  style={{ color: CHART.faint }}
                >
                  {decision.ageDays} дн. ждёт
                </span>
              </span>
              <SourceLink
                href={`/decisions/${decision.id}`}
                label="Открыть"
              />
            </div>
          ))}
        </div>
      )}
    </GlassCard>
  );
};
