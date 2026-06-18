export type SprintActivityColor = 'success' | 'warning' | 'danger';

export interface SprintDailyIssueWithActivityDto {
  issueId: string;
  identifier: string;
  title: string;
  assigneeName: string | null;
  lastActivity: string | null;
  activityColor: SprintActivityColor;
  stateCategory: 'backlog' | 'unstarted' | 'started' | 'completed' | 'cancelled' | null;
}

export interface SprintDailyTopCloserDto {
  userId: string;
  name: string;
  closedCount: number;
}

export interface SprintDailyTopHelperDto {
  userId: string;
  name: string;
  helpfulnessScore: number;
}

export interface SprintDailyDigestDto {
  cycleId: string;
  hypothesisText: string | null;
  aiNarrative: string | null;
  issuesWithActivity: SprintDailyIssueWithActivityDto[];
  topClosers: SprintDailyTopCloserDto[];
  topHelpers: SprintDailyTopHelperDto[];
  alarmCount: number;
  generatedAt: string;
}
