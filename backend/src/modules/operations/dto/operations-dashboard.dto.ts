/**
 * SBA β-8 — DTO ответа `/api/v1/dashboard/operations/*`.
 *
 * Структуры стабильные. Фронт мапит через `frontend/src/domain/operations-dashboard`.
 */

export interface OperationsDashboardBlockerDto {
  id: string;
  text: string;
  severity: 'low' | 'medium' | 'high' | 'unknown';
  ownerHint: string | null;
  /** Person ответственный (если известен). */
  ownerPersonId: string | null;
  ownerPersonName: string | null;
  createdAt: string;
  sourceBlockId: string | null;
  sourceCheckInId: string | null;
}

export interface OperationsDashboardGoalDto {
  id: string;
  name: string;
  status: string;
  parentGoalId: string | null;
  cascadeMissed: boolean;
  cascadeMissedFromGoalId: string | null;
  targetDate: string | null;
}

export interface OperationsDashboardTeamFrictionDto {
  /** EntityLink.id */
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

export interface OperationsDashboardCapacityDto {
  /** Person.id */
  personId: string;
  personName: string;
  /** Сумма loadPercent активных Appointment'ов. */
  loadPercent: number;
  /** Сколько активных Appointment'ов учли. */
  appointmentsCount: number;
}

export interface OperationsDashboardOverviewDto {
  tenantId: string;
  generatedAt: string;
  blockersCount: number;
  blockersBySeverity: Record<'low' | 'medium' | 'high' | 'unknown', number>;
  missedGoalsCount: number;
  cascadeMissedCount: number;
  teamFrictionCount: number;
  capacityAvgPercent: number;
  capacityOverloadedCount: number;
  /** Топ-5 свежих блокеров. */
  topRecentBlockers: OperationsDashboardBlockerDto[];
  /** Топ-5 свежих team_friction. */
  topRecentTeamFrictions: OperationsDashboardTeamFrictionDto[];
}

export interface OperationsDashboardBlockersListDto {
  items: OperationsDashboardBlockerDto[];
  total: number;
}

export interface OperationsDashboardTeamFrictionsListDto {
  items: OperationsDashboardTeamFrictionDto[];
  total: number;
}

export interface OperationsDashboardCapacityListDto {
  items: OperationsDashboardCapacityDto[];
  avgLoadPercent: number;
  overloadedCount: number;
}

export interface PersonalRelationDto {
  /** EntityLink.id */
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

export interface PersonalRelationListDto {
  items: PersonalRelationDto[];
  total: number;
}
