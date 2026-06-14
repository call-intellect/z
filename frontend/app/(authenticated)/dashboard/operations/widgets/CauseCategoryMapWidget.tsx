'use client';

import { PieChart as PieChartIcon } from 'lucide-react';

import {
  CAUSE_CATEGORY_LABELS_RU,
  CAUSE_CATEGORY_ORDER,
} from '@/lib/cause-category-presentation';
import type { InsightCauseCategory } from '@/domain/insight';
import type { InsightCauseCategoryAggregateApi } from '@/api/operations-dashboard.api';
import {
  CardTitle,
  CHART,
  DonutCard,
  GlassCard,
  GRAD,
} from '@/ui/components/dashboard/modern';

/**
 * Цвет сегмента пончика по cause-категории. Литералы CHART (oklch) — recharts
 * `<Cell fill>` нужен литеральный цвет, а не Tailwind-класс из общей палитры.
 */
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

/**
 * SBA β-8.3 Wave 2 — виджет «Карта причин недели».
 *
 * Показывает 8 горизонтальных столбиков (фиксированный порядок из
 * `CAUSE_CATEGORY_ORDER`) — сколько insight'ов попало в каждую категорию
 * за 7 дней (severity ≥ medium). Длина столбика пропорциональна max-value
 * среди всех 8 категорий. Каждая строка — ссылка-фильтр на /insights.
 *
 * Источник данных — `OperationsOverviewDomain.insightsByCauseCategory`
 * (см. `frontend/src/domain/operations-dashboard.ts`). Все строки на русском.
 */
export function CauseCategoryMapWidget(props: {
  insightsByCauseCategory: InsightCauseCategoryAggregateApi;
}) {
  const counts = props.insightsByCauseCategory;
  const total = CAUSE_CATEGORY_ORDER.reduce((acc, k) => acc + (counts[k] ?? 0), 0);

  // Сегменты пончика: только ненулевые категории, в фиксированном порядке.
  const donutData = CAUSE_CATEGORY_ORDER.filter((k) => (counts[k] ?? 0) > 0).map(
    (k) => ({
      name: CAUSE_CATEGORY_LABELS_RU[k],
      value: counts[k] ?? 0,
      c: CAUSE_CATEGORY_DONUT_COLOR[k],
    }),
  );

  if (total === 0) {
    return (
      <GlassCard>
        <CardTitle icon={<PieChartIcon size={16} />} grad={GRAD.pink}>
          Карта причин недели
        </CardTitle>
        <p
          className="mt-4 rounded-xl p-3 text-sm"
          style={{ background: 'var(--surface-inset)', color: CHART.dim }}
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
