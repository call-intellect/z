import { apiClient } from './api-client';
import { orgHeaders } from './admin-helpers';

/**
 * SBA β-8 — API-клиент COO operations dashboard и personal-relations.
 *
 * Контракт: `backend/src/modules/operations/controllers/*.ts`.
 *
 *   GET /api/v1/dashboard/operations/overview
 *   GET /api/v1/dashboard/operations/blockers
 *   GET /api/v1/dashboard/operations/team-frictions
 *   GET /api/v1/dashboard/operations/capacity
 *   GET /api/v1/personal-relations?personId=&relationType=
 *
 * Доступ: owner/admin/coo (см. `RbacService.canViewOperationsDashboard`).
 */

export interface OperationsBlockerApi {
  id: string;
  text: string;
  severity: 'low' | 'medium' | 'high' | 'unknown';
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

/**
 * SBA β-8.3 Wave 2 — агрегат insights по `causeCategory` за 7 дней
 * (severity ≥ medium). 8 ключей, гарантированно непустой объект.
 */
export type InsightCauseCategoryKey =
  | 'process_gap'
  | 'tooling'
  | 'role_skill'
  | 'communication'
  | 'priority'
  | 'resource_constraint'
  | 'external'
  | 'unknown';

export type InsightCauseCategoryAggregateApi = Record<
  InsightCauseCategoryKey,
  number
>;

export interface MaturitySnapshotDomainApi {
  slug: string;
  name: string;
  completeness: number;
}

/**
 * SBA β-8.3 Wave 3 — снапшот зрелости компании для COO-дашборда.
 *
 * Контракт: `backend/src/modules/operations/dto/operations-dashboard.dto.ts:MaturitySnapshotDto`.
 * `score=null` → cron ещё не отработал, показываем заглушку.
 */
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
  blockersBySeverity: Record<'low' | 'medium' | 'high' | 'unknown', number>;
  missedGoalsCount: number;
  cascadeMissedCount: number;
  teamFrictionCount: number;
  capacityAvgPercent: number;
  capacityOverloadedCount: number;
  topRecentBlockers: OperationsBlockerApi[];
  topRecentTeamFrictions: OperationsTeamFrictionApi[];
  // SBA β-8.1 — компактный блок «Температура команды» за 7 дней.
  teamTemperature: OperationsTeamTemperatureSummaryApi;
  /** SBA β-8.3 Wave 2 — агрегат insights по causeCategory (7 дней, severity ≥ medium). */
  insightsByCauseCategory: InsightCauseCategoryAggregateApi;
  /** SBA β-8.3 Wave 3 — снапшот зрелости компании. */
  maturity: MaturitySnapshotApi;
  /** ТЗ-2 Ф2 — закрыто блокеров за 30 дней (зеркало под KPI). */
  blockersResolvedCount: number;
  /** ТЗ-2 Ф2 — закрыто конфликтов за 30 дней (зеркало под KPI). */
  frictionsResolvedCount: number;
  /** ТЗ-2 Ф2 — kill-switch инфо-перекомпоновки COO-дашборда (по умолчанию true). */
  reworkEnabled: boolean;
  /** Недельный инфлоу за 12 недель (old→new, null=нет данных). */
  weeklyInflow: { blockers: Array<number | null>; frictions: Array<number | null> };
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

/**
 * Pulse Wave 2.3 — кто из сотрудников ещё не сделал чек-ин за день.
 * Контракт: `OperationsMissingCheckInsDto` (backend).
 */
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

/**
 * Pulse Wave 2.3 — «Зависшие» задачи трекера (stale > 5 дней или просрочка).
 * Контракт: `OperationsStaleIssuesDto` (backend).
 */
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

/**
 * ТЗ-3 Ф2 — загрузка команд по отделам.
 * Контракт: `GET /api/v1/dashboard/operations/team-capacity`.
 * `loadPercent`-источник заполнен в проде разрежённо → `empty=true` ожидаемо.
 */
export interface OperationsTeamCapacityItemApi {
  departmentId: string;
  departmentName: string;
  personCount: number;
  avgLoadPercent: number;
  maxLoadPercent: number;
  classification: 'overload' | 'underload' | 'ok';
}

export interface OperationsTeamCapacityApi {
  items: OperationsTeamCapacityItemApi[];
  overloadedCount: number;
  underloadedCount: number;
  empty: boolean;
}

/**
 * ТЗ-2 Ф2 — хронические блокеры (живут давно / повторяются).
 * Контракт: `GET /api/v1/dashboard/operations/blockers/chronic?status=&limit=`.
 */
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

/**
 * ТЗ Ф8.7 (cabinet-redesign-rhythms) — «Дисциплина чек-инов».
 * Контракт: `GET /api/v1/dashboard/operations/checkin-discipline?from=&to=`.
 * Зеркало `backend/src/modules/operations/dto/checkin-discipline.dto.ts`.
 *
 * `enabled=false` (флаг `DAILY_CHECKIN_ENABLED` OFF) → totals по нулям, фронт
 * показывает Б-6 «чек-ины выключены».
 */
export interface CheckinDisciplineTotalsApi {
  morningExpected: number;
  morningCompleted: number;
  morningMissed: number;
  eveningExpected: number;
  eveningCompleted: number;
  eveningMissed: number;
  /** 0..1 или null, если ожидаемых чек-инов не было. */
  completionRate: number | null;
}

export interface CheckinDisciplinePersonApi extends CheckinDisciplineTotalsApi {
  personId: string;
  personName: string;
}

export interface CheckinDisciplineApi {
  /** Начало окна (YYYY-MM-DD), как реально применено. */
  from: string;
  /** Конец окна (YYYY-MM-DD), как реально применено. */
  to: string;
  /** Флаг `DAILY_CHECKIN_ENABLED`. false → totals по нулям. */
  enabled: boolean;
  totals: CheckinDisciplineTotalsApi;
  byPerson: CheckinDisciplinePersonApi[];
}

/**
 * ТЗ coo-orphan-agents Ф3 — контролёр доведения решений.
 * Контракт: GET /api/v1/dashboard/operations/decisions/throughput?from=&to=
 *           GET /api/v1/dashboard/operations/decisions/stalled
 */
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

/**
 * ТЗ coo-orphan-agents Ф4 — радар клиентов под риском оттока.
 * Контракт: GET /api/v1/dashboard/operations/customer-risk?level=&limit=
 */
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
  riskLevel: 'critical' | 'warning' | 'ok';
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

/**
 * ТЗ coo-orphan-agents Ф5 — знания под риском (bus-factor × уход носителя).
 * Контракт: GET /api/v1/dashboard/operations/knowledge-at-risk
 */
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

export const operationsDashboardApi = {
  getOverview: () =>
    apiClient.get<OperationsOverviewApi>('/api/v1/dashboard/operations/overview'),
  getBlockers: () =>
    apiClient.get<{ items: OperationsBlockerApi[]; total: number }>(
      '/api/v1/dashboard/operations/blockers',
    ),
  getTeamFrictions: () =>
    apiClient.get<{ items: OperationsTeamFrictionApi[]; total: number }>(
      '/api/v1/dashboard/operations/team-frictions',
    ),
  getCapacity: () =>
    apiClient.get<OperationsCapacityListApi>(
      '/api/v1/dashboard/operations/capacity',
    ),
  listPersonalRelations: (params?: {
    personId?: string;
    relationType?: string;
  }) => {
    const q = new URLSearchParams();
    if (params?.personId) q.set('personId', params.personId);
    if (params?.relationType) q.set('relationType', params.relationType);
    const suffix = q.toString();
    return apiClient.get<{ items: PersonalRelationApi[]; total: number }>(
      `/api/v1/personal-relations${suffix ? `?${suffix}` : ''}`,
    );
  },
  /**
   * SBA β-8.1 — `GET /dashboard/operations/team-temperature?days=7`.
   * Полный разрез настроений по людям.
   */
  getTeamTemperature: (days = 7) =>
    apiClient.get<OperationsTeamTemperatureApi>(
      `/api/v1/dashboard/operations/team-temperature?days=${days}`,
    ),
  /**
   * Pulse Wave 2.3 — `GET /dashboard/operations/missing-checkins?date=YYYY-MM-DD`.
   * Если `date` не передан — backend использует сегодня (МСК).
   */
  getMissingCheckIns: (date?: string) =>
    apiClient.get<OperationsMissingCheckInsApi>(
      `/api/v1/dashboard/operations/missing-checkins${date ? `?date=${date}` : ''}`,
    ),
  /**
   * Pulse Wave 2.3 — `GET /dashboard/operations/stale-issues?staleDays=5&limit=20`.
   * Зависшие/просроченные задачи трекера.
   */
  getStaleIssues: (params?: { staleDays?: number; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.staleDays !== undefined) q.set('staleDays', String(params.staleDays));
    if (params?.limit !== undefined) q.set('limit', String(params.limit));
    const suffix = q.toString();
    return apiClient.get<OperationsStaleIssuesApi>(
      `/api/v1/dashboard/operations/stale-issues${suffix ? `?${suffix}` : ''}`,
    );
  },
  /**
   * ТЗ-3 Ф2 — `GET /dashboard/operations/team-capacity`.
   * Загрузка по отделам (avg/max %, классификация перегруз/недогруз/в норме).
   */
  getTeamCapacity: () =>
    apiClient.get<OperationsTeamCapacityApi>(
      '/api/v1/dashboard/operations/team-capacity',
    ),
  /**
   * ТЗ-2 Ф2 — `GET /dashboard/operations/blockers/chronic?status=&limit=`.
   * Хронические блокеры (давно открытые / повторяющиеся).
   */
  getChronicBlockers: (params?: { status?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set('status', params.status);
    if (params?.limit !== undefined) q.set('limit', String(params.limit));
    const suffix = q.toString();
    return apiClient.get<OperationsChronicBlockersApi>(
      `/api/v1/dashboard/operations/blockers/chronic${suffix ? `?${suffix}` : ''}`,
    );
  },
  /**
   * ТЗ coo-orphan-agents Ф4 — клиенты под риском оттока (топ по riskScore).
   * limit ≤ 20 (защита от лавины запросов на drill-down).
   */
  getCustomerRisk: (params?: { level?: 'critical' | 'warning' | 'ok'; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.level) q.set('level', params.level);
    const limit = Math.min(20, params?.limit ?? 20);
    q.set('limit', String(limit));
    return apiClient.get<CustomerRiskListApi>(
      `/api/v1/dashboard/operations/customer-risk?${q.toString()}`,
    );
  },
  /**
   * ТЗ coo-orphan-agents Ф3 — % решений, доведённых до результата (за окно,
   * дефолт сервера — 90 дней).
   */
  getDecisionThroughput: (params?: { from?: string; to?: string }) => {
    const q = new URLSearchParams();
    if (params?.from) q.set('from', params.from);
    if (params?.to) q.set('to', params.to);
    const suffix = q.toString();
    return apiClient.get<DecisionThroughputApi>(
      `/api/v1/dashboard/operations/decisions/throughput${suffix ? `?${suffix}` : ''}`,
    );
  },
  /** ТЗ coo-orphan-agents Ф3 — решения без движения (stalled). */
  getStalledDecisions: () =>
    apiClient.get<StalledDecisionsApi>(
      '/api/v1/dashboard/operations/decisions/stalled',
    ),
  /** ТЗ coo-orphan-agents Ф5 — знания под риском (critical→warning→ok). */
  getKnowledgeAtRisk: () =>
    apiClient.get<KnowledgeAtRiskListApi>(
      '/api/v1/dashboard/operations/knowledge-at-risk',
    ),
  /**
   * ТЗ Ф8.7 — `GET /dashboard/operations/checkin-discipline?from=&to=`.
   * Дисциплина чек-инов (ожидаемо/сдано/пропущено, суммарно и по людям).
   * Без `from`/`to` backend берёт текущую неделю (понедельник..сегодня МСК).
   * Для плашки «Сегодня» вызывать с `from=to=`<сегодня (локальная дата)>.
   */
  getCheckinDiscipline: (orgId: string, from?: string, to?: string) => {
    const q = new URLSearchParams();
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    const suffix = q.toString();
    return apiClient.get<CheckinDisciplineApi>(
      `/api/v1/dashboard/operations/checkin-discipline${suffix ? `?${suffix}` : ''}`,
      { headers: orgHeaders(orgId) },
    );
  },
};
