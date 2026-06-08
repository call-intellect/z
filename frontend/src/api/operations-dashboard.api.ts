import { apiClient } from './api-client';

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
};
