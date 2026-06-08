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
  OperationsChronicBlockerApi,
  OperationsChronicBlockersApi,
  OperationsOverviewApi,
  OperationsTeamCapacityApi,
  OperationsTeamCapacityItemApi,
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
  /** ТЗ-2 Ф2 — закрыто блокеров за 30 дней (default 0 — защита от старого API). */
  blockersResolvedCount: number;
  /** ТЗ-2 Ф2 — закрыто конфликтов за 30 дней (default 0). */
  frictionsResolvedCount: number;
  /** ТЗ-2 Ф2 — kill-switch инфо-перекомпоновки (default true). */
  reworkEnabled: boolean;
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
    // Защитные дефолты: старый API мог не отдавать эти поля.
    blockersResolvedCount: api.blockersResolvedCount ?? 0,
    frictionsResolvedCount: api.frictionsResolvedCount ?? 0,
    reworkEnabled: api.reworkEnabled ?? true,
  };
}

/* ------------------------------------------------------------------ */
/* ТЗ-3 Ф2 — загрузка команд по отделам                               */
/* ------------------------------------------------------------------ */

export type TeamCapacityClassification = 'overload' | 'underload' | 'ok';

/** Русские подписи классификации загрузки отдела. */
export const TEAM_CAPACITY_CLASSIFICATION_LABEL: Record<
  TeamCapacityClassification,
  string
> = {
  overload: 'перегруз',
  underload: 'недогруз',
  ok: 'в норме',
};

export interface TeamCapacityItemDomain {
  departmentId: string;
  departmentName: string;
  personCount: number;
  avgLoadPercent: number;
  maxLoadPercent: number;
  classification: TeamCapacityClassification;
  /** Готовая русская подпись классификации. */
  classificationLabel: string;
}

export interface TeamCapacityDomain {
  items: TeamCapacityItemDomain[];
  overloadedCount: number;
  underloadedCount: number;
  empty: boolean;
}

function normalizeClassification(value: string): TeamCapacityClassification {
  return value === 'overload' || value === 'underload' ? value : 'ok';
}

function fromTeamCapacityItemApi(
  api: OperationsTeamCapacityItemApi,
): TeamCapacityItemDomain {
  const classification = normalizeClassification(api.classification);
  return {
    departmentId: api.departmentId,
    departmentName: api.departmentName,
    personCount: api.personCount,
    avgLoadPercent: api.avgLoadPercent,
    maxLoadPercent: api.maxLoadPercent,
    classification,
    classificationLabel: TEAM_CAPACITY_CLASSIFICATION_LABEL[classification],
  };
}

export function fromTeamCapacityApi(
  api: OperationsTeamCapacityApi,
): TeamCapacityDomain {
  return {
    items: (api.items ?? []).map(fromTeamCapacityItemApi),
    overloadedCount: api.overloadedCount ?? 0,
    underloadedCount: api.underloadedCount ?? 0,
    empty: api.empty ?? true,
  };
}

/* ------------------------------------------------------------------ */
/* ТЗ-2 Ф2 — хронические блокеры                                       */
/* ------------------------------------------------------------------ */

export type ChronicBlockerStatus = 'new' | 'recurring' | 'resolved';

/** Русские подписи статуса хронического блокера. */
export const CHRONIC_BLOCKER_STATUS_LABEL: Record<ChronicBlockerStatus, string> = {
  new: 'новый',
  recurring: 'повторяется',
  resolved: 'закрыт',
};

export interface ChronicBlockerDomain {
  id: string;
  representativeText: string;
  status: ChronicBlockerStatus;
  /** Готовая русская подпись статуса. */
  statusLabel: string;
  daysOpen: number;
  businessImpactScore: number;
  firstSeenDateLocal: string;
  lastSeenDateLocal: string;
  linkedInsightId: string | null;
  responsiblePersonId: string | null;
}

function normalizeChronicStatus(value: string): ChronicBlockerStatus {
  return value === 'recurring' || value === 'resolved' ? value : 'new';
}

function fromChronicBlockerApi(
  api: OperationsChronicBlockerApi,
): ChronicBlockerDomain {
  const status = normalizeChronicStatus(api.status);
  return {
    id: api.id,
    representativeText: api.representativeText,
    status,
    statusLabel: CHRONIC_BLOCKER_STATUS_LABEL[status],
    daysOpen: api.daysOpen,
    businessImpactScore: api.businessImpactScore,
    firstSeenDateLocal: api.firstSeenDateLocal,
    lastSeenDateLocal: api.lastSeenDateLocal,
    linkedInsightId: api.linkedInsightId,
    responsiblePersonId: api.responsiblePersonId,
  };
}

export function fromChronicBlockersApi(
  api: OperationsChronicBlockersApi,
): ChronicBlockerDomain[] {
  return (api.items ?? []).map(fromChronicBlockerApi);
}
