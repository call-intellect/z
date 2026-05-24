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
};
