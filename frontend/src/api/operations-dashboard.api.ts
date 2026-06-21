import { apiClient } from "./api-client";
import { orgHeaders } from "./admin-helpers";

export interface OperationsBlockerApi {
  id: string;
  text: string;
  severity: "low" | "medium" | "high" | "unknown";
  ownerHint: string | null;
  ownerPersonId: string | null;
  ownerPersonName: string | null;
  createdAt: string;
  sourceBlockId: string | null;
  sourceCheckInId: string | null;
}

export interface OperationsTeamFrictionApi {
  id: string;
  fromPersonId: string;
  fromPersonName: string | null;
  toPersonId: string;
  toPersonName: string | null;
  relationType: string;
  confidence: number;
  explanation: string;
  observedAt: string;
}

export interface OperationsCapacityApi {
  personId: string;
  personName: string;
  loadPercent: number;
  appointmentsCount: number;
}

export type InsightCauseCategoryKey =
  | "process_gap"
  | "tooling"
  | "role_skill"
  | "communication"
  | "priority"
  | "resource_constraint"
  | "external"
  | "unknown";

export type InsightCauseCategoryAggregateApi = Record<
  InsightCauseCategoryKey,
  number
>;

export interface MaturitySnapshotDomainApi {
  slug: string;
  name: string;
  completeness: number;
}

export interface MaturitySnapshotApi {
  score: number | null;
  lastCalcAt: string | null;
  stage: string | null;
  weakestDomains: MaturitySnapshotDomainApi[];
  topDomains: MaturitySnapshotDomainApi[];
}

export interface OperationsOverviewApi {
  tenantId: string;
  generatedAt: string;
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
  maturity: MaturitySnapshotApi;
  blockersResolvedCount: number;
  frictionsResolvedCount: number;
  reworkEnabled: boolean;
  weeklyInflow: {
    blockers: Array<number | null>;
    frictions: Array<number | null>;
  };
}

export interface OperationsTeamTemperatureSummaryApi {
  days: number;
  totalCheckIns: number;
  greenShare: number;
  yellowShare: number;
  redShare: number;
  redShareDelta: number | null;
}

export interface OperationsTeamTemperaturePersonApi {
  personId: string;
  personName: string | null;
  green: number;
  yellow: number;
  red: number;
  total: number;
}

export interface OperationsTeamTemperatureApi {
  days: number;
  totalCheckIns: number;
  greenShare: number;
  yellowShare: number;
  redShare: number;
  redShareDelta: number | null;
  byPerson: OperationsTeamTemperaturePersonApi[];
}

export interface OperationsCapacityListApi {
  items: OperationsCapacityApi[];
  avgLoadPercent: number;
  overloadedCount: number;
}

export interface OperationsMissingCheckInApi {
  personId: string;
  personName: string | null;
  primaryDepartmentId: string | null;
}

export interface OperationsMissingCheckInsApi {
  date: string;
  totalEmployees: number;
  missing: OperationsMissingCheckInApi[];
}

export interface OperationsStaleIssueApi {
  issueId: string;
  title: string;
  identifier: string;
  daysSinceActivity: number;
  daysOverdue: number | null;
  assigneeUserIds: string[];
}

export interface OperationsStaleIssuesApi {
  items: OperationsStaleIssueApi[];
}

export interface OperationsTeamCapacityItemApi {
  departmentId: string;
  departmentName: string;
  personCount: number;
  avgLoadPercent: number;
  maxLoadPercent: number;
  classification: "overload" | "underload" | "ok";
}

export interface OperationsTeamCapacityApi {
  items: OperationsTeamCapacityItemApi[];
  overloadedCount: number;
  underloadedCount: number;
  empty: boolean;
}

export interface OperationsChronicBlockerApi {
  id: string;
  representativeText: string;
  status: string;
  daysOpen: number;
  businessImpactScore: number;
  firstSeenDateLocal: string;
  lastSeenDateLocal: string;
  linkedInsightId: string | null;
  responsiblePersonId: string | null;
  relatedBlockIds: string[];
}

export interface OperationsChronicBlockersApi {
  items: OperationsChronicBlockerApi[];
}

export interface PersonalRelationApi {
  id: string;
  fromPersonId: string;
  fromPersonName: string | null;
  toPersonId: string;
  toPersonName: string | null;
  relationType: string;
  confidence: number;
  explanation: string;
  createdAt: string;
  observedAt: string | null;
}

export interface CheckinDisciplineTotalsApi {
  morningExpected: number;
  morningCompleted: number;
  morningMissed: number;
  eveningExpected: number;
  eveningCompleted: number;
  eveningMissed: number;
  completionRate: number | null;
}

export interface CheckinDisciplinePersonApi extends CheckinDisciplineTotalsApi {
  personId: string;
  personName: string;
}

export interface CheckinDisciplineApi {
  from: string;
  to: string;
  enabled: boolean;
  totals: CheckinDisciplineTotalsApi;
  byPerson: CheckinDisciplinePersonApi[];
}

export interface DecisionThroughputApi {
  total: number;
  doneWithOutcomes: number;
  throughputPercent: number;
  from: string;
  to: string;
}

export interface StalledDecisionApi {
  id: string;
  statement: string;
  decidedAt: string | null;
  ageDays: number;
  implementationCheckedAt: string | null;
}

export interface StalledDecisionsApi {
  items: StalledDecisionApi[];
}

export interface CustomerRiskTopBlockApi {
  blockId: string;
  signalType: string;
  excerpt: string;
}

export interface CustomerRiskSnapshotApi {
  id: string;
  customerEntityId: string;
  customerName: string;
  dateLocal: string;
  signalCounts: {
    churn_risk: number;
    objection: number;
    pain: number;
    feature_request: number;
  };
  windowDays: number;
  riskScore: number;
  riskLevel: "critical" | "warning" | "ok";
  scoreDelta: number;
  signalDelta: number;
  responsiblePersonId: string | null;
  responsiblePersonName: string | null;
  topBlocks: CustomerRiskTopBlockApi[];
  hint: string;
  snapshotAt: string;
}

export interface CustomerRiskListApi {
  items: CustomerRiskSnapshotApi[];
  criticalCount: number;
  warningCount: number;
}

export interface KnowledgeAtRiskItemApi {
  categoryName: string;
  soleExpertPersonId: string | null;
  soleExpertPersonName: string | null;
  busFactorLevel: string;
  personRiskLevel: string | null;
  combinedSeverity: string;
  snapshotAt: string;
}

export interface KnowledgeAtRiskListApi {
  items: KnowledgeAtRiskItemApi[];
}

/**
 * ТЗ coo-orphan-agents Ф7 — перегруз ответственностью (сеть обещаний).
 * Контракт: GET /api/v1/dashboard/operations/promise-network
 */
export interface PromiseNetworkNodeApi {
  personId: string;
  name: string;
  inDegree: number;
  outDegree: number;
  balance: number;
}

export interface PromiseNetworkApi {
  hasData: boolean;
  snapshotAt: string | null;
  totalCommitments: number;
  accumulators: PromiseNetworkNodeApi[];
}

export const operationsDashboardApi = {
  getOverview: () =>
    apiClient.get<OperationsOverviewApi>(
      "/api/v1/dashboard/operations/overview",
    ),
  getBlockers: () =>
    apiClient.get<{ items: OperationsBlockerApi[]; total: number }>(
      "/api/v1/dashboard/operations/blockers",
    ),
  getTeamFrictions: () =>
    apiClient.get<{ items: OperationsTeamFrictionApi[]; total: number }>(
      "/api/v1/dashboard/operations/team-frictions",
    ),
  getCapacity: () =>
    apiClient.get<OperationsCapacityListApi>(
      "/api/v1/dashboard/operations/capacity",
    ),
  listPersonalRelations: (params?: {
    personId?: string;
    relationType?: string;
  }) => {
    const q = new URLSearchParams();
    if (params?.personId) q.set("personId", params.personId);
    if (params?.relationType) q.set("relationType", params.relationType);
    const suffix = q.toString();
    return apiClient.get<{ items: PersonalRelationApi[]; total: number }>(
      `/api/v1/personal-relations${suffix ? `?${suffix}` : ""}`,
    );
  },
  getTeamTemperature: (days = 7) =>
    apiClient.get<OperationsTeamTemperatureApi>(
      `/api/v1/dashboard/operations/team-temperature?days=${days}`,
    ),
  getMissingCheckIns: (date?: string) =>
    apiClient.get<OperationsMissingCheckInsApi>(
      `/api/v1/dashboard/operations/missing-checkins${date ? `?date=${date}` : ""}`,
    ),
  getStaleIssues: (params?: { staleDays?: number; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.staleDays !== undefined)
      q.set("staleDays", String(params.staleDays));
    if (params?.limit !== undefined) q.set("limit", String(params.limit));
    const suffix = q.toString();
    return apiClient.get<OperationsStaleIssuesApi>(
      `/api/v1/dashboard/operations/stale-issues${suffix ? `?${suffix}` : ""}`,
    );
  },
  getTeamCapacity: () =>
    apiClient.get<OperationsTeamCapacityApi>(
      "/api/v1/dashboard/operations/team-capacity",
    ),
  getChronicBlockers: (params?: { status?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set("status", params.status);
    if (params?.limit !== undefined) q.set("limit", String(params.limit));
    const suffix = q.toString();
    return apiClient.get<OperationsChronicBlockersApi>(
      `/api/v1/dashboard/operations/blockers/chronic${suffix ? `?${suffix}` : ""}`,
    );
  },
  getCustomerRisk: (params?: {
    level?: "critical" | "warning" | "ok";
    limit?: number;
  }) => {
    const q = new URLSearchParams();
    if (params?.level) q.set("level", params.level);
    const limit = Math.min(20, params?.limit ?? 20);
    q.set("limit", String(limit));
    return apiClient.get<CustomerRiskListApi>(
      `/api/v1/dashboard/operations/customer-risk?${q.toString()}`,
    );
  },
  getDecisionThroughput: (params?: { from?: string; to?: string }) => {
    const q = new URLSearchParams();
    if (params?.from) q.set("from", params.from);
    if (params?.to) q.set("to", params.to);
    const suffix = q.toString();
    return apiClient.get<DecisionThroughputApi>(
      `/api/v1/dashboard/operations/decisions/throughput${suffix ? `?${suffix}` : ""}`,
    );
  },
  getStalledDecisions: () =>
    apiClient.get<StalledDecisionsApi>(
      "/api/v1/dashboard/operations/decisions/stalled",
    ),
  getKnowledgeAtRisk: () =>
    apiClient.get<KnowledgeAtRiskListApi>(
      "/api/v1/dashboard/operations/knowledge-at-risk",
    ),
  getPromiseNetwork: () =>
    apiClient.get<PromiseNetworkApi>(
      "/api/v1/dashboard/operations/promise-network",
    ),
  getCheckinDiscipline: (orgId: string, from?: string, to?: string) => {
    const q = new URLSearchParams();
    if (from) q.set("from", from);
    if (to) q.set("to", to);
    const suffix = q.toString();
    return apiClient.get<CheckinDisciplineApi>(
      `/api/v1/dashboard/operations/checkin-discipline${suffix ? `?${suffix}` : ""}`,
      { headers: orgHeaders(orgId) },
    );
  },
};
