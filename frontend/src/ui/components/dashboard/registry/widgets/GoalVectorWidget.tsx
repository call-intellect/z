"use client";

import type { FC } from "react";
import { useState } from "react";
import { Sparkles, Target } from "lucide-react";
import useSWR from "swr";

import { dashboardApi } from "@/api/dashboard.api";
import {
  executionDashboardApi,
  type GoalVectorByPersonDirection,
} from "@/api/execution-dashboard.api";
import type { PulsePatternGoalVectorItemApi } from "@/domain/pulse-patterns";
import { useAuth } from "@/contexts/auth-context";
import {
  CardTitle,
  CHART,
  GlassCard,
  GRAD,
} from "@/ui/components/dashboard/modern";
import { Skeleton } from "@/ui/shadcn/skeleton";

import type { Rhythm } from "../types";
import { MiniArrow, PeopleDrawer, PersonRow } from "../_kit";

function directionFromNet(net: number): GoalVectorByPersonDirection {
  if (net > 0.5) return "up";
  if (net < -0.5) return "down";
  return "side";
}

function fmtScore(value: number): string {
  if (Math.abs(value) >= 10) return String(Math.round(value));
  return value.toFixed(1);
}

export const GoalVectorWidget: FC<{ rhythm: Rhythm }> = ({ rhythm }) => {
  const { currentOrgId } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const pulsePeriod = rhythm === "month" ? "month" : "week";
  const directorPeriod = rhythm === "month" ? "month" : "week";
  const personPeriod = rhythm === "today" ? "day" : rhythm;

  const pulseSwr = useSWR(
    currentOrgId ? ["goalvec-pulse", currentOrgId, pulsePeriod] : null,
    async () => dashboardApi.getPulsePatterns(currentOrgId!, pulsePeriod),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  const directorSwr = useSWR(
    currentOrgId ? ["goalvec-director", currentOrgId, directorPeriod] : null,
    async () => dashboardApi.getDirectorView(currentOrgId!, directorPeriod),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  const personSwr = useSWR(
    currentOrgId ? ["goalvec-by-person", currentOrgId, personPeriod] : null,
    async () =>
      executionDashboardApi.getGoalVectorByPerson(currentOrgId!, {
        period: personPeriod,
      }),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  const goalVector = pulseSwr.data?.goalVector;
  const goals = goalVector?.goals ?? [];
  const primaryGoal: PulsePatternGoalVectorItemApi | null = goalVector
    ? (goals.find((g) => g.goalId === goalVector.primaryGoalId) ??
      goals.find((g) => g.isPrimary) ??
      goals[0] ??
      null)
    : null;

  const narrative = directorSwr.data?.narrativeSummary?.text ?? null;
  const rows = personSwr.data?.rows ?? [];

  const loading = pulseSwr.isLoading || directorSwr.isLoading;

  if (loading) {
    return (
      <GlassCard>
        <CardTitle icon={<Target size={16} />} grad={GRAD.violet}>
          Вектор к цели
        </CardTitle>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      </GlassCard>
    );
  }

  if (!primaryGoal) {
    return (
      <GlassCard>
        <CardTitle icon={<Target size={16} />} grad={GRAD.violet}>
          Вектор к цели
        </CardTitle>
        <p
          className="mt-6 py-6 text-center text-sm"
          style={{ color: CHART.faint }}
        >
          Цель компании не задана — задайте главную цель, чтобы видеть, куда
          движется команда.
        </p>
      </GlassCard>
    );
  }

  const net = primaryGoal.netScore;
  const direction = directionFromNet(net);

  return (
    <GlassCard>
      <CardTitle icon={<Target size={16} />} grad={GRAD.violet}>
        Вектор к цели
      </CardTitle>

      <div className="mt-4 grid gap-5 md:grid-cols-2">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <span className="scale-150">
              <MiniArrow direction={direction} />
            </span>
            <p
              className="text-base font-semibold"
              style={{ color: CHART.text }}
            >
              {primaryGoal.goalTitle}
            </p>
          </div>
          <p className="text-sm tabular-nums" style={{ color: CHART.dim }}>
            за период: +{fmtScore(primaryGoal.proScore)} про / −
            {fmtScore(primaryGoal.contraScore)} контра
          </p>
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="mt-1 inline-flex w-fit items-center gap-2 rounded-full px-3.5 py-2 text-sm font-medium transition hover:brightness-110"
            style={{
              background: "var(--surface-inset-strong)",
              color: CHART.text,
            }}
          >
            Развернуть по людям
          </button>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Sparkles size={15} style={{ color: CHART.violet }} />
            <span
              className="text-xs font-medium uppercase tracking-wide"
              style={{ color: CHART.faint }}
            >
              Сводка Коры
            </span>
          </div>
          {narrative ? (
            <p
              className="text-sm leading-relaxed"
              style={{ color: CHART.dim }}
            >
              {narrative}
            </p>
          ) : (
            <p className="text-sm" style={{ color: CHART.faint }}>
              Сводка появится, когда накопятся данные за период.
            </p>
          )}
        </div>
      </div>

      <PeopleDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        title="По людям — где цель стопорится"
        subtitle="Кому помочь, чтобы команда двигалась к цели"
      >
        {rows.length === 0 ? (
          <p className="text-sm" style={{ color: CHART.faint }}>
            Пока нет данных по людям.
          </p>
        ) : (
          rows.map((row) => (
            <PersonRow
              key={row.personId}
              name={row.personName}
              sub={`сделано ${row.tasksDone} · висит ${row.tasksOpen}`}
              right={<MiniArrow direction={row.direction} />}
            />
          ))
        )}
      </PeopleDrawer>
    </GlassCard>
  );
};
