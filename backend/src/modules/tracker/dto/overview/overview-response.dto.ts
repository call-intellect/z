export interface OverviewProjectMiniDto {
  id: string;
  slug: string;
  identifier: string;
  name: string;
  description: string | null;
  archivedAt: string | null;
  cycleViewEnabled: boolean;
  intakeViewEnabled: boolean;
  gantViewEnabled: boolean;
}

export interface OverviewUserMiniDto {
  id: string;
  name: string | null;
  email: string | null;
  role: number;
}

export interface OverviewMetricsDto {
  totalIssues: number;
  inProgressIssues: number;
  overdueIssues: number;
  completedLast7d: number;
}

export type OverviewStateCategory = 'backlog' | 'unstarted' | 'started' | 'completed' | 'cancelled';

export interface OverviewStateBucketDto {
  category: OverviewStateCategory;
  count: number;
}

export interface OverviewActiveCycleDto {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  progressSnapshot: unknown;
  alignmentScore: number | null;
}

export interface OverviewActivityItemDto {
  id: string;
  issueId: string;
  issueIdentifier: string | null;
  actorUserId: string | null;
  actorType: string;
  verb: string;
  field: string | null;
  oldValue: unknown;
  newValue: unknown;
  createdAt: string;
}

export interface OverviewLinkedGoalDto {
  id: string;
  name: string;
  status: string;
  cachedAlignment: number | null;
  targetDate: string | null;
}

export interface OverviewProjectDocumentMiniDto {
  id: string;
  title: string;
  updatedAt: string;
}

export interface OverviewResponseDto {
  project: OverviewProjectMiniDto;
  members: OverviewUserMiniDto[];
  metrics: OverviewMetricsDto;
  statesDistribution: OverviewStateBucketDto[];
  activeCycle: OverviewActiveCycleDto | null;
  recentActivity: OverviewActivityItemDto[];
  linkedGoals: OverviewLinkedGoalDto[];
  recentDocuments: OverviewProjectDocumentMiniDto[];
}
