/**
 * SBA β-8 / β-8.3 — доменная модель COO-дашборда (overview-агрегат).
 *
 * Мапит ApiDto → Domain: даты ISO → Date; insightsByCauseCategory копируем
 * как есть (бэк всегда отдаёт все 8 ключей, см. ТЗ §1.5 Wave 2).
 *
 * Используется в `OperationsDashboardClient.tsx` и виджетах под ним
 * (`CauseCategoryMapWidget`, `MaturityWidget`).
 */

import type {
  InsightCauseCategoryAggregateApi,
  InsightCauseCategoryKey,
  MaturitySnapshotApi,
  MaturitySnapshotDomainApi,
  OperationsBlockerApi,
  OperationsOverviewApi,
  OperationsTeamFrictionApi,
  OperationsTeamTemperatureSummaryApi,
} from '@/api/operations-dashboard.api';

export type {
  InsightCauseCategoryAggregateApi as InsightCauseCategoryAggregateDomain,
  InsightCauseCategoryKey,
};

export interface MaturitySnapshotDomainItem {
  slug: string;
  name: string;
  /** 0..1; гарантированно not-null (фильтр на стороне сервиса). */
  completeness: number;
  /** Percent 0..100, округлено — для UI. */
  completenessPercent: number;
}

export interface MaturitySnapshotDomain {
  score: number | null;
  /** Percent 0..100 или null. */
  scorePercent: number | null;
  lastCalcAt: Date | null;
  stage: string | null;
  weakestDomains: MaturitySnapshotDomainItem[];
  topDomains: MaturitySnapshotDomainItem[];
}

export interface OperationsOverviewDomain {
  tenantId: string;
  generatedAt: Date;
  blockersCount: number;
  blockersBySeverity: Record<'low' | 'medium' | 'high' | 'unknown', number>;
  missedGoalsCount: number;
  cascadeMissedCount: number;
  teamFrictionCount: number;
  capacityAvgPercent: number;
  capacityOverloadedCount: number;
  topRecentBlockers: OperationsBlockerApi[];
  topRecentTeamFrictions: OperationsTeamFrictionApi[];
  teamTemperature: OperationsTeamTemperatureSummaryApi;
  insightsByCauseCategory: InsightCauseCategoryAggregateApi;
  maturity: MaturitySnapshotDomain;
}

function toPercent(v: number | null | undefined): number | null {
  if (v === null || v === undefined || Number.isNaN(v)) return null;
  return Math.round(Math.max(0, Math.min(1, v)) * 100);
}

function fromMaturityDomainItem(
  api: MaturitySnapshotDomainApi,
): MaturitySnapshotDomainItem {
  return {
    slug: api.slug,
    name: api.name,
    completeness: api.completeness,
    completenessPercent: toPercent(api.completeness) ?? 0,
  };
}

export function fromMaturitySnapshotApi(
  api: MaturitySnapshotApi,
): MaturitySnapshotDomain {
  return {
    score: api.score,
    scorePercent: toPercent(api.score),
    lastCalcAt: api.lastCalcAt ? new Date(api.lastCalcAt) : null,
    stage: api.stage ?? null,
    weakestDomains: (api.weakestDomains ?? []).map(fromMaturityDomainItem),
    topDomains: (api.topDomains ?? []).map(fromMaturityDomainItem),
  };
}

export function fromOperationsOverviewApi(
  api: OperationsOverviewApi,
): OperationsOverviewDomain {
  return {
    tenantId: api.tenantId,
    generatedAt: new Date(api.generatedAt),
    blockersCount: api.blockersCount,
    blockersBySeverity: api.blockersBySeverity,
    missedGoalsCount: api.missedGoalsCount,
    cascadeMissedCount: api.cascadeMissedCount,
    teamFrictionCount: api.teamFrictionCount,
    capacityAvgPercent: api.capacityAvgPercent,
    capacityOverloadedCount: api.capacityOverloadedCount,
    topRecentBlockers: api.topRecentBlockers,
    topRecentTeamFrictions: api.topRecentTeamFrictions,
    teamTemperature: api.teamTemperature,
    insightsByCauseCategory: api.insightsByCauseCategory,
    maturity: fromMaturitySnapshotApi(api.maturity),
  };
}
