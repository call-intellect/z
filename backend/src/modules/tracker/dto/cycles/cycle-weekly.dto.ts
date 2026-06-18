export interface SprintWeeklyVelocityDto {
  closedThisWeek: number;
  closedPrevWeek: number;
  trend: 'up' | 'flat' | 'down';
}

export interface SprintWeeklyTeamHealthRowDto {
  departmentId: string;
  departmentName: string;
  size: number;
  belowCohort: boolean;
  sentiment: number | null;
  promises: number | null;
}

export interface SprintWeeklyLearningDto {
  ideaBlockId: string;
  title: string;
  signalType: string;
}

export interface SprintWeeklyForecastDto {
  trend: 'improving' | 'stable' | 'declining' | null;
  summary: string | null;
  snapshotAt: string | null;
}

export interface SprintWeeklyDigestDto {
  cycleId: string;
  hypothesisText: string | null;
  hypothesisConfirmed: boolean | null;
  aiNarrative: string | null;
  velocity: SprintWeeklyVelocityDto;
  teamHealth: SprintWeeklyTeamHealthRowDto[];
  outcomeMetric: {
    completedPercent: number;
    completed: number;
    total: number;
  };
  learnings: SprintWeeklyLearningDto[];
  actionItems: string[];
  forecast: SprintWeeklyForecastDto;
  generatedAt: string;
}
