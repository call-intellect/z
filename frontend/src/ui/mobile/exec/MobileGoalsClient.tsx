"use client";

import Link from "next/link";
import useSWR from "swr";
import { AlertCircle, Target } from "lucide-react";

import { goalsApi } from "@/api/goals.api";
import { humanizeApiError } from "@/api/api-error";
import { useAuth } from "@/contexts/auth-context";
import { goalFromApi } from "@/domain/goal";
import { Skeleton } from "@/ui/shadcn/skeleton";
import { GlanceGauge } from "@/ui/mobile/shared/GlanceGauge";
import { DrillList } from "@/ui/mobile/shared/DrillList";
import { goalsKeyRows, mainGoal, mainGoalPercent } from "./goals-rows";

export function MobileGoalsClient() {
  const { currentOrgId } = useAuth();

  const swr = useSWR(
    currentOrgId ? (["goals", currentOrgId, "active"] as const) : null,
    async ([, orgId, status]) => {
      const res = await goalsApi.list(orgId, { status, limit: 100 });
      return res.items.map(goalFromApi);
    },
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  const goals = swr.data ?? null;
  const loading = !!currentOrgId && swr.isLoading && !goals;
  const error = swr.error
    ? humanizeApiError(swr.error, "Не удалось загрузить цели")
    : null;

  const main = goals ? mainGoal(goals) : null;
  const mainPct = mainGoalPercent(main);
  const keyRows = goals ? goalsKeyRows(goals, main?.id ?? null) : [];
  const empty = !loading && !error && goals !== null && goals.length === 0;

  return (
    <div className="mx-auto w-full max-w-md px-4 py-5">
      <h1 className="mb-1 flex items-center gap-2 text-xl font-semibold text-fg-primary">
        <Target size={20} className="text-accent" aria-hidden />
        Цели
      </h1>
      <p className="mb-4 text-sm text-fg-secondary">
        Куда движемся — одним взглядом.
      </p>

      {loading && <GoalsSkeleton />}

      {!loading && error && (
        <div className="mb-4 flex items-center gap-2 rounded-xl bg-chip-danger-bg p-3 text-sm text-chip-danger-fg">
          <AlertCircle size={16} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!loading && !error && empty && (
        <div
          data-testid="goals-empty"
          className="rounded-2xl border border-border-subtle bg-bg-card p-5 text-center"
        >
          <Target size={24} className="mx-auto mb-2 text-accent" aria-hidden />
          <p className="text-base font-medium text-fg-primary">
            Целей пока нет
          </p>
          <p className="mt-1 text-sm text-fg-secondary">
            Задайте цель компании — Кора начнёт отслеживать движение к ней.
          </p>
        </div>
      )}

      {!loading && !error && !empty && main && (
        <>
          {}
          <Link
            href={`/goals/${encodeURIComponent(main.id)}`}
            className="mb-5 flex flex-col items-center rounded-2xl border border-border-subtle bg-bg-card p-4 active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            data-testid="goals-main"
          >
            <div className="mb-2 text-center text-base font-medium text-fg-primary">
              {main.name}
            </div>
            <GlanceGauge percent={mainPct} label="движение к цели" />
          </Link>

          {}
          {keyRows.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-medium text-fg-secondary">
                Ключевые результаты
              </h2>
              <DrillList items={keyRows} />
            </section>
          )}
        </>
      )}
    </div>
  );
}

function GoalsSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-32 w-full rounded-2xl" />
      <Skeleton className="h-20 w-full rounded-2xl" />
      <Skeleton className="h-20 w-full rounded-2xl" />
    </div>
  );
}
