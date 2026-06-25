"use client";

import type { FC } from "react";
import { Activity, AlertTriangle, Target, TrendingUp } from "lucide-react";
import useSWR from "swr";

import { ApiError } from "@/api/api-error";
import { weeklyDigestApi } from "@/api/weekly-digest.api";
import { useAuth } from "@/contexts/auth-context";
import {
  AreaTrend,
  BarTrend,
  CardTitle,
  CHART,
  GlassCard,
  GRAD,
} from "@/ui/components/dashboard/modern";
import { Skeleton } from "@/ui/shadcn/skeleton";

import type { Rhythm } from "../types";

function lastMondayUtc(): string {
  const d = new Date();
  const dow = d.getUTCDay();
  const offset = dow === 0 ? -6 : -(dow - 1);
  const monday = new Date(d);
  monday.setUTCDate(monday.getUTCDate() + offset);
  return monday.toISOString().slice(0, 10);
}

function formatRuShort(dateLocal: string): string {
  const [, m, d] = dateLocal.split("-");
  return `${d}.${m}`;
}

export const WeeklyDynamicsWidget: FC<{ rhythm: Rhythm }> = () => {
  const { currentOrgId } = useAuth();
  const weekStart = lastMondayUtc();

  const digestSwr = useSWR(
    currentOrgId ? ["weekly-dynamics", currentOrgId, weekStart] : null,
    async () => {
      try {
        return await weeklyDigestApi.get(weekStart);
      } catch (err) {
        if (
          err instanceof ApiError &&
          (err.code === "digest_not_found" || err.code === "not_found")
        ) {
          return null;
        }
        throw err;
      }
    },
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  if (digestSwr.isLoading) {
    return (
      <GlassCard>
        <CardTitle icon={<TrendingUp size={16} />} grad={GRAD.violet}>
          Динамика по неделям
        </CardTitle>
        <Skeleton className="mt-4 h-48" />
      </GlassCard>
    );
  }

  const trend = digestSwr.data?.trend ?? [];
  if (trend.length < 2) return null;

  const moodData = trend.map((p) => ({
    weekStart: formatRuShort(p.weekStart),
    greenShare: Math.round(p.greenShare * 100),
    redShare: Math.round(p.redShare * 100),
  }));
  const execData = trend.map((p) => ({
    weekStart: formatRuShort(p.weekStart),
    goalsCompleted: p.goalsCompleted,
    hangingDecisions: p.hangingDecisions,
  }));
  const blockersData = trend.map((p) => ({
    weekStart: formatRuShort(p.weekStart),
    blockers: p.blockers,
  }));

  return (
    <div className="space-y-6">
      <GlassCard>
        <CardTitle icon={<TrendingUp size={16} />} grad={GRAD.violet}>
          Динамика по неделям
        </CardTitle>
        <p className="mt-1 text-sm" style={{ color: CHART.dim }}>
          План-факт и настроение команды по неделям месяца.
        </p>
        <div className="mt-4 grid gap-6 lg:grid-cols-2">
          <AreaTrend
            title="Настроение по неделям"
            titleIcon={<Activity size={16} />}
            titleGrad={GRAD.teal}
            data={moodData}
            xKey="weekStart"
            series={[
              { key: "greenShare", color: CHART.mint, label: "Зелёные" },
              { key: "redShare", color: CHART.red, label: "Красные" },
            ]}
            height={240}
          />
          <AreaTrend
            title="Исполнение по неделям"
            titleIcon={<Target size={16} />}
            titleGrad={GRAD.violet}
            data={execData}
            xKey="weekStart"
            series={[
              { key: "goalsCompleted", color: CHART.mint, label: "Закрытые цели" },
              {
                key: "hangingDecisions",
                color: CHART.red,
                label: "Висящие решения",
              },
            ]}
            height={240}
          />
        </div>
        <div className="mt-6">
          <BarTrend
            title="Блокеры по неделям"
            icon={<AlertTriangle size={16} />}
            grad={GRAD.amber}
            data={blockersData}
            xKey="weekStart"
            dataKey="blockers"
            height={200}
          />
        </div>
      </GlassCard>
    </div>
  );
};
