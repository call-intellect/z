"use client";

import type { PulsePatternKnowledgeVelocityApi } from "@/domain/pulse-patterns";

import { CountUp } from "@/ui/components/dashboard/charts";
import { KpiHero } from "@/ui/components/shared/KpiHero";

type Props = {
  data: PulsePatternKnowledgeVelocityApi | null;
};

function formatHours(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 100) return `${Math.round(n)} ч`;
  return `${n.toFixed(1)} ч`;
}

export function KnowledgeVelocityKpi({ data }: Props) {
  const median = data?.medianHours ?? null;
  const numericValue = median === null ? Number.MAX_SAFE_INTEGER : median;

  const value =
    median === null ? "—" : <CountUp to={median} format={formatHours} />;

  return (
    <KpiHero
      label="Скорость знаний"
      value={value}
      numericValue={numericValue}
      threshold={{ green: 24, yellow: 72, inverted: true }}
    />
  );
}
