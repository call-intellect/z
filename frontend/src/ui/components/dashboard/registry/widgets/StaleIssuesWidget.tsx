"use client";

import type { FC } from "react";
import { useState } from "react";
import Link from "next/link";
import { Hourglass } from "lucide-react";
import useSWR from "swr";

import { operationsDashboardApi } from "@/api/operations-dashboard.api";
import { useAuth } from "@/contexts/auth-context";
import {
  CardTitle,
  CHART,
  GlassCard,
  GRAD,
} from "@/ui/components/dashboard/modern";
import { Skeleton } from "@/ui/shadcn/skeleton";

import type { Rhythm } from "../types";

export const StaleIssuesWidget: FC<{ rhythm: Rhythm }> = () => {
  const { currentOrgId } = useAuth();
  const [showAll, setShowAll] = useState(false);

  const staleSwr = useSWR(
    currentOrgId ? ["stale-issues", currentOrgId] : null,
    async () =>
      operationsDashboardApi.getStaleIssues({ staleDays: 5, limit: 20 }),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  if (staleSwr.isLoading) {
    return (
      <GlassCard>
        <CardTitle icon={<Hourglass size={16} />} grad={GRAD.amber}>
          Что зависло
        </CardTitle>
        <Skeleton className="mt-4 h-24" />
      </GlassCard>
    );
  }

  const items = staleSwr.data?.items ?? [];

  if (items.length === 0) {
    return (
      <GlassCard>
        <CardTitle icon={<Hourglass size={16} />} grad={GRAD.amber}>
          Что зависло
        </CardTitle>
        <p
          className="mt-6 py-6 text-center text-sm"
          style={{ color: CHART.faint }}
        >
          Зависших нет — всё в движении.
        </p>
      </GlassCard>
    );
  }

  return (
    <GlassCard>
      <CardTitle icon={<Hourglass size={16} />} grad={GRAD.amber}>
        Что зависло
      </CardTitle>

      <div className="mt-3 text-[30px] font-semibold leading-none tracking-tight">
        {items.length}
      </div>
      <p className="mt-1 text-sm" style={{ color: CHART.dim }}>
        задач без движения
      </p>

      <ul className="mt-4 space-y-2">
        {(showAll ? items : items.slice(0, 5)).map((item) => (
          <li key={item.issueId}>
            <Link
              href={`/issues/${item.issueId}`}
              className="flex w-full items-center justify-between gap-3 rounded-xl p-2.5 transition hover:brightness-110"
              style={{ background: "var(--surface-inset)" }}
            >
              <span className="min-w-0 flex-1">
                <span
                  className="block truncate text-sm font-medium"
                  style={{ color: CHART.text }}
                >
                  {item.title}{" "}
                  <span style={{ color: CHART.faint }}>{item.identifier}</span>
                </span>
                <span
                  className="block truncate text-xs"
                  style={{ color: CHART.faint }}
                >
                  {item.daysOverdue != null
                    ? `просрочка ${item.daysOverdue} дн.`
                    : `${item.daysSinceActivity} дн. без движения`}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {items.length > 5 && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="mt-3 text-sm font-medium transition hover:brightness-110"
          style={{ color: CHART.dim }}
        >
          {showAll ? "Свернуть" : `Показать все (${items.length})`}
        </button>
      )}
    </GlassCard>
  );
};
