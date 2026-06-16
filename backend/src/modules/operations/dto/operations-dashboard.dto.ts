export interface OperationsDashboardBlockerDto {
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
  personId: string;
  personName: string;
  loadPercent: number;
  appointmentsCount: number;
}

export type OperationsInsightCauseCategory =
  | 'process_gap'
  | 'tooling'
  | 'role_skill'
  | 'communication'
  | 'priority'
  | 'resource_constraint'
  | 'external'
  | 'unknown';

export type InsightCauseCategoryAggregateDto = Record<OperationsInsightCauseCategory, number>;

export interface MaturitySnapshotDomainDto {
  slug: string;
  name: string;
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
  blockersResolvedCount: number;
  frictionsResolvedCount: number;
  reworkEnabled: boolean;
  capacityAvgPercent: number;
  capacityOverloadedCount: number;
  topRecentBlockers: OperationsDashboardBlockerDto[];
  topRecentTeamFrictions: OperationsDashboardTeamFrictionDto[];
  teamTemperature: OperationsTeamTemperatureSummaryDto;
  insightsByCauseCategory: InsightCauseCategoryAggregateDto;
  maturity: MaturitySnapshotDto;
  weeklyInflow: {
    blockers: Array<number | null>;
    frictions: Array<number | null>;
  };
}

export interface OperationsTeamTemperatureSummaryDto {
  days: number;
  totalCheckIns: number;
  greenShare: number;
  yellowShare: number;
  redShare: number;
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
