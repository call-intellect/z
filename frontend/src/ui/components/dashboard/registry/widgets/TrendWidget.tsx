"use client";

import type { FC } from "react";
import { TrendingUp } from "lucide-react";
import useSWR from "swr";

import { executionDashboardApi } from "@/api/execution-dashboard.api";
import { useAuth } from "@/contexts/auth-context";
import {
  CardTitle,
  CHART,
  GlassCard,
  GRAD,
} from "@/ui/components/dashboard/modern";
import { Skeleton } from "@/ui/shadcn/skeleton";

import type { Rhythm } from "../types";
import { MiniArrow } from "../_kit";

type Direction = "up" | "side" | "down";

interface TrendMetric {
  key: string;
  label: string;
  goodWhenUp: boolean;
}

const TREND_METRICS: TrendMetric[] = [
  { key: "greenShare", label: "Настроение в норме", goodWhenUp: true },
  { key: "yellowShare", label: "Команда подустала", goodWhenUp: false },
  { key: "redShare", label: "Команде тяжело", goodWhenUp: false },
  { key: "totalCheckIns", label: "Чек-инов за период", goodWhenUp: true },
];

const SHARE_KEYS = new Set(["greenShare", "yellowShare", "redShare"]);

function formatValue(key: string, value: number): string {
  if (SHARE_KEYS.has(key)) return `${Math.round(value * 100)}%`;
  return String(Math.round(value));
}

function formatDelta(key: string, delta: number, comparedTo: string): string {
  const sign = delta >= 0 ? "+" : "−";
  const abs = Math.abs(delta);
  if (SHARE_KEYS.has(key)) {
    return `${sign}${Math.round(abs * 100)} п.п. ${comparedTo}`;
  }
  return `${sign}${Math.round(abs)} ${comparedTo}`;
}

function directionOf(delta: number, goodWhenUp: boolean): Direction {
  if (delta === 0) return "side";
  const rising = delta > 0;
  const good = goodWhenUp ? rising : !rising;
  return good ? "up" : "down";
}

export const TrendWidget: FC<{ rhythm: Rhythm }> = ({ rhythm }) => {
  const { currentOrgId } = useAuth();

  const period = rhythm === "month" ? "month" : "week";
  const title = period === "month" ? "Месяц к месяцу" : "Идём лучше или хуже";
  const subtitle =
    period === "month"
      ? "Сравнение с прошлым месяцем."
      : "Сравнение с прошлой неделей.";
  const comparedTo =
    period === "month" ? "к прошлому месяцу" : "к прошлой неделе";

  const trendSwr = useSWR(
    currentOrgId ? ["operations-trend", currentOrgId, period] : null,
    async () =>
      executionDashboardApi.getOperationsTrend(currentOrgId!, { period }),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  if (trendSwr.isLoading) {
    return (
      <GlassCard>
        <CardTitle icon={<TrendingUp size={16} />} grad={GRAD.teal}>
          {title}
        </CardTitle>
        <div className="mt-4 space-y-3">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      </GlassCard>
    );
  }

  const current = trendSwr.data?.current ?? null;
  if (!current) return null;

  const deltas = trendSwr.data?.deltas ?? {};
  const rows = TREND_METRICS.filter(
    (m) => typeof current[m.key] === "number",
  );

  if (rows.length === 0) return null;

  return (
    <GlassCard>
      <CardTitle icon={<TrendingUp size={16} />} grad={GRAD.teal}>
        {title}
      </CardTitle>
      <p className="mt-1 text-sm" style={{ color: CHART.dim }}>
        {subtitle}
      </p>

      <ul className="mt-4 space-y-2">
        {rows.map((m) => {
          const value = current[m.key]!;
          const delta = deltas[m.key] ?? 0;
          const direction = directionOf(delta, m.goodWhenUp);
          return (
            <li
              key={m.key}
              className="flex items-center gap-3 rounded-xl p-3"
              style={{ background: "var(--surface-inset)" }}
            >
              <MiniArrow direction={direction} />
              <span className="min-w-0 flex-1">
                <span
                  className="block text-sm font-medium"
                  style={{ color: CHART.text }}
                >
                  {m.label}: {formatValue(m.key, value)}
                </span>
                <span
                  className="block text-xs tabular-nums"
                  style={{ color: CHART.faint }}
                >
                  {formatDelta(m.key, delta, comparedTo)}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </GlassCard>
  );
};
