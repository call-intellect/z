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
} from "@/api/operations-dashboard.api";

export type {
  InsightCauseCategoryAggregateApi as InsightCauseCategoryAggregateDomain,
  InsightCauseCategoryKey,
};

export interface MaturitySnapshotDomainItem {
  slug: string;
  name: string;
  completeness: number;
  completenessPercent: number;
}

export interface MaturitySnapshotDomain {
  score: number | null;
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
  blockersBySeverity: Record<"low" | "medium" | "high" | "unknown", number>;
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
  blockersResolvedCount: number;
  frictionsResolvedCount: number;
  reworkEnabled: boolean;
  weeklyInflow: {
    blockers: Array<number | null>;
    frictions: Array<number | null>;
  };
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
    blockersResolvedCount: api.blockersResolvedCount ?? 0,
    frictionsResolvedCount: api.frictionsResolvedCount ?? 0,
    reworkEnabled: api.reworkEnabled ?? true,
    weeklyInflow: api.weeklyInflow ?? { blockers: [], frictions: [] },
  };
}

export type TeamCapacityClassification = "overload" | "underload" | "ok";

export const TEAM_CAPACITY_CLASSIFICATION_LABEL: Record<
  TeamCapacityClassification,
  string
> = {
  overload: "перегруз",
  underload: "недогруз",
  ok: "в норме",
};

export interface TeamCapacityItemDomain {
  departmentId: string;
  departmentName: string;
  personCount: number;
  avgLoadPercent: number;
  maxLoadPercent: number;
  classification: TeamCapacityClassification;
  classificationLabel: string;
}

export interface TeamCapacityDomain {
  items: TeamCapacityItemDomain[];
  overloadedCount: number;
  underloadedCount: number;
  empty: boolean;
}

function normalizeClassification(value: string): TeamCapacityClassification {
  return value === "overload" || value === "underload" ? value : "ok";
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

export type ChronicBlockerStatus = "new" | "recurring" | "resolved";

export const CHRONIC_BLOCKER_STATUS_LABEL: Record<
  ChronicBlockerStatus,
  string
> = {
  new: "новый",
  recurring: "повторяется",
  resolved: "закрыт",
};

export interface ChronicBlockerDomain {
  id: string;
  representativeText: string;
  status: ChronicBlockerStatus;
  statusLabel: string;
  daysOpen: number;
  businessImpactScore: number;
  firstSeenDateLocal: string;
  lastSeenDateLocal: string;
  linkedInsightId: string | null;
  responsiblePersonId: string | null;
}

function normalizeChronicStatus(value: string): ChronicBlockerStatus {
  return value === "recurring" || value === "resolved" ? value : "new";
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
