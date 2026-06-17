"use client";

import { PieChart as PieChartIcon } from "lucide-react";

import {
  CAUSE_CATEGORY_LABELS_RU,
  CAUSE_CATEGORY_ORDER,
} from "@/lib/cause-category-presentation";
import type { InsightCauseCategory } from "@/domain/insight";
import type { InsightCauseCategoryAggregateApi } from "@/api/operations-dashboard.api";
import {
  CardTitle,
  CHART,
  DonutCard,
  GlassCard,
  GRAD,
} from "@/ui/components/dashboard/modern";

const CAUSE_CATEGORY_DONUT_COLOR: Record<InsightCauseCategory, string> = {
  process_gap: CHART.red,
  communication: CHART.amber,
  priority: CHART.pink,
  role_skill: CHART.violet,
  tooling: CHART.blue,
  resource_constraint: CHART.orange,
  external: CHART.cyan,
  unknown: CHART.faint,
};

export function CauseCategoryMapWidget(props: {
  insightsByCauseCategory: InsightCauseCategoryAggregateApi;
}) {
  const counts = props.insightsByCauseCategory;
  const total = CAUSE_CATEGORY_ORDER.reduce(
    (acc, k) => acc + (counts[k] ?? 0),
    0,
  );

  const donutData = CAUSE_CATEGORY_ORDER.filter(
    (k) => (counts[k] ?? 0) > 0,
  ).map((k) => ({
    name: CAUSE_CATEGORY_LABELS_RU[k],
    value: counts[k] ?? 0,
    c: CAUSE_CATEGORY_DONUT_COLOR[k],
  }));

  if (total === 0) {
    return (
      <GlassCard>
        <CardTitle icon={<PieChartIcon size={16} />} grad={GRAD.pink}>
          Карта причин недели
        </CardTitle>
        <p
          className="mt-4 rounded-xl p-3 text-sm"
          style={{ background: "var(--surface-inset)", color: CHART.dim }}
        >
          За последние 7 дней новых сигналов средней / высокой важности нет.
        </p>
      </GlassCard>
    );
  }

  return (
    <DonutCard
      title="Карта причин недели"
      icon={<PieChartIcon size={16} />}
      grad={GRAD.pink}
      data={donutData}
      centerValue={String(total)}
      centerLabel="сигналов"
    />
  );
}
