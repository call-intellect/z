'use client';

import type { PulsePatternKnowledgeVelocityApi } from '@/domain/pulse-patterns';

import { CountUp } from '@/ui/components/dashboard/charts';
import { KpiHero } from '@/ui/components/shared/KpiHero';

/**
 * KnowledgeVelocityKpi (Pulse Wave 6 §6.7) — KPI hero.
 *
 * Медиана часов от появления `knowledge_gap` до `trustedAnswer`. Порог:
 *   - ≤24h  → success
 *   - ≤72h  → warning
 *   - >72h  → danger
 *
 * Полировка (Фаза 3 ТЗ dashboards-wow-polish, 2026-06-01):
 *   - Главное число обёрнуто в `CountUp` (плавный счёт при рендере).
 *   - Sparkline в этой версии не отдаётся бэком — передавать нечего, KpiHero
 *     сам это переживёт (показывает только число + тон-цвет).
 *   - Стрелка тренда уже цветная в KpiHero по знаку дельты.
 */

type Props = {
  data: PulsePatternKnowledgeVelocityApi | null;
};

function formatHours(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (n >= 100) return `${Math.round(n)} ч`;
  return `${n.toFixed(1)} ч`;
}

export function KnowledgeVelocityKpi({ data }: Props) {
  const median = data?.medianHours ?? null;
  const numericValue = median === null ? Number.MAX_SAFE_INTEGER : median;

  const value =
    median === null ? (
      '—'
    ) : (
      <CountUp to={median} format={formatHours} />
    );

  return (
    <KpiHero
      label="Скорость знаний"
      value={value}
      numericValue={numericValue}
      threshold={{ green: 24, yellow: 72, inverted: true }}
    />
  );
}
