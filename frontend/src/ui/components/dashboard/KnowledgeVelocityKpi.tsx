'use client';

import type { PulsePatternKnowledgeVelocityApi } from '@/domain/pulse-patterns';

import { KpiHero } from '@/ui/components/shared/KpiHero';

/**
 * KnowledgeVelocityKpi (Pulse Wave 6 §6.7) — KPI hero.
 *
 * Медиана часов от появления `knowledge_gap` до `trustedAnswer`. Порог:
 *   - ≤24h  → success
 *   - ≤72h  → warning
 *   - >72h  → danger
 *
 * Sparkline в этой версии не отдаётся бэком — поле опц., оставляем пустым.
 */

type Props = {
  data: PulsePatternKnowledgeVelocityApi | null;
};

export function KnowledgeVelocityKpi({ data }: Props) {
  const median = data?.medianHours ?? null;
  const value =
    median === null
      ? '—'
      : median >= 100
        ? `${Math.round(median)} ч`
        : `${median.toFixed(1)} ч`;
  const numericValue = median === null ? Number.MAX_SAFE_INTEGER : median;

  return (
    <KpiHero
      label="Скорость знаний"
      value={value}
      numericValue={numericValue}
      threshold={{ green: 24, yellow: 72, inverted: true }}
    />
  );
}
