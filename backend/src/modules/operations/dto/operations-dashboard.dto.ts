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

/**
 * SBA β-8.3 Wave 2 (Фаза 2) — категории первопричины insights.
 *
 * 8 значений из `Insight.causeCategory` (см. schema.prisma и
 * `insights.dto.ts:InsightCauseCategorySchema`). Записи с `causeCategory=NULL`
 * сваливаются в bucket `'unknown'`. UI получает ВСЕ 8 ключей — даже если
 * значение 0 (для предсказуемой раскладки виджета «Карта причин»).
 */
export type OperationsInsightCauseCategory =
  | 'process_gap'
  | 'tooling'
  | 'role_skill'
  | 'communication'
  | 'priority'
  | 'resource_constraint'
  | 'external'
  | 'unknown';

export type InsightCauseCategoryAggregateDto = Record<
  OperationsInsightCauseCategory,
  number
>;

/**
 * SBA β-8.3 Wave 2 (Фаза 3) — снапшот зрелости компании для дашборда COO.
 *
 * Источники:
 * - `CompanyProfile.maturityScore` (0..1, пересчитывает `MaturityScorerCron`)
 * - `CompanyProfile.lastMaturityCalcAt` / `stage`
 * - `FunctionalDomain.completeness` (0..1) — для weakest/top.
 *
 * `weakestDomains`/`topDomains` — массивы до 3-х элементов (фактическая длина
 * зависит от того, сколько `FunctionalDomain` имеют ненулевой `completeness`).
 * При полном отсутствии данных — пустые массивы и `score=null`.
 */
export interface MaturitySnapshotDomainDto {
  slug: string;
  name: string;
  /** 0..1; гарантированно not-null (фильтр на стороне сервиса). */
  completeness: number;
}

export interface MaturitySnapshotDto {
  score: number | null;
  lastCalcAt: string | null;
  stage: string | null;
  weakestDomains: MaturitySnapshotDomainDto[];
  topDomains: MaturitySnapshotDomainDto[];
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
  /**
   * SBA β-8.3 Wave 2 (Фаза 2) — агрегат insights по `causeCategory` за 7 дней
   * (severity ∈ medium|high). Все 8 ключей всегда заполнены (0 если нет
   * данных) — для предсказуемой раскладки виджета «Карта причин».
   */
  insightsByCauseCategory: InsightCauseCategoryAggregateDto;
  /**
   * SBA β-8.3 Wave 2 (Фаза 3) — снапшот зрелости компании
   * (CompanyProfile.maturityScore + топ/слабые FunctionalDomain'ы).
   */
  maturity: MaturitySnapshotDto;
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

/**
 * Pulse Wave 2.3 — кто из сотрудников ещё не сделал чек-ин за день.
 *
 * `date` — YYYY-MM-DD (МСК по умолчанию из контроллера; можно прислать
 * через `?date=`). `totalEmployees` — все Person.relationship='employee'
 * (не удалённые). `missing` — те, у кого нет ни одной DailyCheckIn за `date`.
 */
export interface OperationsMissingCheckInDto {
  personId: string;
  personName: string | null;
  primaryDepartmentId: string | null;
}

export interface OperationsMissingCheckInsDto {
  date: string;
  totalEmployees: number;
  missing: OperationsMissingCheckInDto[];
}

/**
 * Pulse Wave 2.3 — «зависшие» задачи трекера для виджета операций.
 *
 * Источник «зависает»:
 *   - `updatedAt < now − staleDays` (по умолчанию 5 дней), ИЛИ
 *   - `dueDate < now` без `completedAt` (просрочка).
 *
 * `daysOverdue=null` если задача не просрочена (срок не наступил или
 * не задан). `assigneeUserIds` берётся из relation `IssueAssignee`.
 */
export interface OperationsStaleIssueDto {
  issueId: string;
  title: string;
  identifier: string;
  daysSinceActivity: number;
  daysOverdue: number | null;
  assigneeUserIds: string[];
}

export interface OperationsStaleIssuesDto {
  items: OperationsStaleIssueDto[];
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
