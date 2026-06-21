"use client";

import type { FC } from "react";
import { Trophy } from "lucide-react";
import useSWR from "swr";

import { goalsApi } from "@/api/goals.api";
import { useAuth } from "@/contexts/auth-context";
import { goalFromApi } from "@/domain/goal";
import {
  CardTitle,
  CHART,
  GlassCard,
  GRAD,
} from "@/ui/components/dashboard/modern";
import { Skeleton } from "@/ui/shadcn/skeleton";

import type { Rhythm } from "../types";
import { Chip, SourceLink } from "../_kit";

function isWithinCurrentMonth(date: Date): boolean {
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth()
  );
}

export const AchievementsWidget: FC<{ rhythm: Rhythm }> = () => {
  const { currentOrgId } = useAuth();

  const goalsSwr = useSWR(
    currentOrgId ? ["achievements-goals", currentOrgId] : null,
    async () => goalsApi.list(currentOrgId!, { status: "achieved", limit: 100 }),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  if (goalsSwr.isLoading) {
    return (
      <GlassCard>
        <CardTitle icon={<Trophy size={16} />} grad={GRAD.amber}>
          Достижения месяца
        </CardTitle>
        <div className="mt-4 space-y-2">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      </GlassCard>
    );
  }

  const goals = (goalsSwr.data?.items ?? [])
    .map(goalFromApi)
    .filter((g) => g.status === "achieved" && isWithinCurrentMonth(g.updatedAt));

  if (goals.length === 0) return null;

  return (
    <GlassCard>
      <CardTitle icon={<Trophy size={16} />} grad={GRAD.amber}>
        Достижения месяца
      </CardTitle>
      <p className="mt-1 text-sm" style={{ color: CHART.dim }}>
        Цели, закрытые за этот месяц.
      </p>

      <ul className="mt-4 space-y-2">
        {goals.map((goal) => (
          <li
            key={goal.id}
            className="flex items-center gap-3 rounded-xl p-3"
            style={{ background: "var(--surface-inset)" }}
          >
            <span className="min-w-0 flex-1">
              <span
                className="block truncate text-sm font-medium"
                style={{ color: CHART.text }}
              >
                {goal.name}
              </span>
            </span>
            <Chip tone="ok">достигнуто</Chip>
            <SourceLink href={`/goals/${goal.id}`} label="Открыть" />
          </li>
        ))}
      </ul>
    </GlassCard>
  );
};
