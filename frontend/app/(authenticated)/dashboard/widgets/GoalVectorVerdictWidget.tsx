"use client";

import Link from "next/link";
import { Compass } from "lucide-react";

import type {
  DirectorDashboardStrategicAlignmentDomain,
  GoalsPulseDomain,
  GoalTreeNodeDomain,
} from "@/domain/director-dashboard";
import {
  CardTitle,
  CHART,
  GaugeCard,
  GlassCard,
  GRAD,
} from "@/ui/components/dashboard/modern";

function collectKeyResultProgress(
  nodes: GoalTreeNodeDomain[],
  acc: number[],
): void {
  for (const node of nodes) {
    if (node.status === "active") {
      for (const kr of node.keyResults) {
        if (Number.isFinite(kr.progressPercent)) {
          acc.push(kr.progressPercent);
        }
      }
    }
    if (node.children.length > 0) {
      collectKeyResultProgress(node.children, acc);
    }
  }
}

type PulseChip = {
  key: keyof GoalsPulseDomain;
  label: string;
  color: string;
};

const PULSE_CHIPS: readonly PulseChip[] = [
  { key: "onTrackCount", label: "В движении", color: CHART.mint },
  { key: "atRiskCount", label: "Под риском", color: CHART.amber },
  { key: "stalledCount", label: "Застряло", color: CHART.red },
  { key: "achievedCount", label: "Достигнуто", color: CHART.cyan },
  { key: "droppedCount", label: "Выпало", color: CHART.faint },
];

export function GoalVectorVerdictWidget({
  goalsTree,
  strategicAlignment,
  goalsPulse,
}: {
  goalsTree: GoalTreeNodeDomain[] | null;
  strategicAlignment: DirectorDashboardStrategicAlignmentDomain | null;
  goalsPulse: GoalsPulseDomain | null;
}) {
  const hasGoals = !!goalsTree && goalsTree.length > 0;

  if (!hasGoals) {
    return (
      <GlassCard>
        <CardTitle icon={<Compass size={16} />} grad={GRAD.violet}>
          Вектор к цели
        </CardTitle>
        <div className="mt-4 flex flex-col items-start gap-2">
          <p className="text-sm" style={{ color: CHART.dim }}>
            Цель ещё не задана. Создайте первую цель — и компас покажет,
            движется ли компания к ней по факту.
          </p>
          <Link
            href="/goals"
            className="text-sm font-medium hover:underline"
            style={{ color: CHART.cyan }}
          >
            К целям →
          </Link>
        </div>
      </GlassCard>
    );
  }

  const krProgress: number[] = [];
  collectKeyResultProgress(goalsTree!, krProgress);
  const factProgress =
    krProgress.length > 0
      ? Math.round(krProgress.reduce((s, v) => s + v, 0) / krProgress.length)
      : 0;

  const alignmentEstimate = strategicAlignment?.average ?? null;

  const totalPulse = goalsPulse?.total ?? 0;

  return (
    <div className="space-y-4">
      <GaugeCard
        title="Движение к цели (факт)"
        icon={<Compass size={16} />}
        grad={GRAD.violet}
        value={factProgress}
        max={100}
      />

      <GlassCard>
        {alignmentEstimate !== null && (
          <div className="flex items-baseline justify-between gap-3">
            <div className="flex items-center gap-2">
              <span
                className="text-2xl font-semibold tabular-nums"
                style={{ color: CHART.text }}
              >
                {Math.round(alignmentEstimate)}
              </span>
              <span className="text-sm" style={{ color: CHART.dim }}>
                согласованность стратегии
              </span>
            </div>
            <span
              className="rounded-full px-2 py-0.5 text-[11px] font-medium"
              style={{
                color: CHART.amber,
                background: "oklch(0.84 0.16 80 / 0.12)",
              }}
              title="LLM-оценка, а не твёрдая метрика"
            >
              оценка
            </span>
          </div>
        )}

        {goalsPulse && totalPulse > 0 && (
          <div
            className={
              alignmentEstimate !== null
                ? "mt-4 flex flex-wrap gap-2"
                : "flex flex-wrap gap-2"
            }
          >
            {PULSE_CHIPS.map((chip) => {
              const count = goalsPulse[chip.key];
              if (count <= 0) return null;
              return (
                <span
                  key={chip.key}
                  className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs"
                  style={{
                    background: "var(--surface-inset)",
                    color: CHART.dim,
                  }}
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: chip.color }}
                  />
                  {chip.label}
                  <span
                    className="font-semibold tabular-nums"
                    style={{ color: CHART.text }}
                  >
                    {count}
                  </span>
                </span>
              );
            })}
          </div>
        )}
      </GlassCard>
    </div>
  );
}
