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
  /**
   * SBA β-8.1 — компактный блок «Температура команды» за последние 7 дней.
   * Подробный разрез (по людям/командам) — через `GET /team-temperature`.
   */
  teamTemperature: OperationsTeamTemperatureSummaryDto;
}

/**
 * SBA β-8.1 — Сводка «Температуры команды» за период.
 *
 * `byPerson` — разрез по сотрудникам (для виджета с горизонтальными
 * столбиками). Содержит только тех, у кого был хотя бы один чек-ин с
 * проставленным sentiment.
 */
export interface OperationsTeamTemperatureSummaryDto {
  /** Окно в днях (по умолчанию 7). */
  days: number;
  /** Всего чек-инов с проставленным sentiment за период. */
  totalCheckIns: number;
  /** Доля «зелёных» (0..1). */
  greenShare: number;
  /** Доля «жёлтых» (0..1). */
  yellowShare: number;
  /** Доля «красных» (0..1). */
  redShare: number;
  /**
   * Динамика: дельта доли красных к предыдущему такому же окну.
   * Положительное = команде стало хуже; null = недостаточно данных за
   * предыдущий период.
   */
  redShareDelta: number | null;
}

export interface OperationsTeamTemperaturePersonDto {
  personId: string;
  personName: string | null;
  green: number;
  yellow: number;
  red: number;
  total: number;
}

export interface OperationsTeamTemperatureDto {
  days: number;
  totalCheckIns: number;
  greenShare: number;
  yellowShare: number;
  redShare: number;
  redShareDelta: number | null;
  byPerson: OperationsTeamTemperaturePersonDto[];
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
