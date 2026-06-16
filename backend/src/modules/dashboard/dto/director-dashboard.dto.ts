import { z } from 'zod';

export const DirectorDashboardQuerySchema = z.object({
  period: z.enum(['week', 'month']).default('week'),
});
export type DirectorDashboardQuery = z.infer<typeof DirectorDashboardQuerySchema>;

export type CitationType = 'ib' | 'theme' | 'ent' | 'mtg' | 'goal' | 'dec';

export interface CitationDto {
  number: number;
  type: CitationType;
  id: string;
  label: string;
  url: string | null;
}

export interface NarrativeSummaryDto {
  text: string;
  citations: CitationDto[];
}

export interface DirectorDashboardKpiDto {
  value: number;
  sparkline: Array<number | null>;
  delta: number | null;
  trend?: 'up' | 'flat' | 'down';
}

export interface DirectorDashboardThemeDto {
  id: string;
  name: string;
  branch: string | null;
  weight: number;
  dynamic: 'growing' | 'stable' | 'declining';
  blocksCount: number;
  lastSignalAt: string | null;
}

export interface DirectorDashboardSignalDto {
  id: string;
  name: string;
  signalType: string;
  confidence: number;
  criticalQuestion: string;
  trustedAnswer: string;
  evidenceMeetingId: string | null;
  reasonSourceRef: {
    meetingId?: string;
    meetingTitle?: string;
    decisionId?: string;
  } | null;
}

export interface DirectorDashboardSignalCountersDto {
  pain: number;
  feature_request: number;
  churn_risk: number;
  objection: number;
  risk: number;
  decision: number;
  commitment: number;
  other: number;
}

export interface DirectorDashboardEntityDto {
  id: string;
  canonicalName: string;
  type: string;
  recentMentions: number;
}

export interface DirectorDashboardOpenQuestionDto {
  id: string;
  name: string;
  criticalQuestion: string;
  createdAt: string;
}

export interface DirectorDashboardValueStripDto {
  meetingsProtocoled: number;
  tasksExtracted: number;
  decisionsExtracted: number;
  questionsAnsweredByMemory: number;
  commitmentsKept: number;
}

export interface DirectorDashboardAlertGoalDto {
  id: string;
  name: string;
  score: number;
  delta: number;
}

export interface DirectorDashboardStrategicAlignmentDto {
  average: number | null;
  goalsCount: number;
  alertGoals: DirectorDashboardAlertGoalDto[];
}

export interface DirectorDashboardRequiresActionDto {
  total: number;
  bySource: {
    curation: number;
    conflict: number;
    intake: number;
    probe: number;
  };
}

export interface DirectorDashboardGoalTreeKrDto {
  id: string;
  name: string;
  progressPercent: number;
  unit: string | null;
}

export interface DirectorDashboardGoalTreeNodeDto {
  id: string;
  name: string;
  status: string;
  progressStatus: string;
  cachedAlignment: number | null;
  weight: number;
  parentGoalId: string | null;
  keyResults: DirectorDashboardGoalTreeKrDto[];
  children: DirectorDashboardGoalTreeNodeDto[];
}

export interface DirectorDashboardGoalsPulseDto {
  onTrackCount: number;
  atRiskCount: number;
  stalledCount: number;
  achievedCount: number;
  droppedCount: number;
  total: number;
}

export interface DirectorDashboardDto {
  period: 'week' | 'month';
  generatedAt: string;
  newThemes: DirectorDashboardThemeDto[];
  newSignals: DirectorDashboardSignalDto[];
  signalCounters: DirectorDashboardSignalCountersDto;
  activeThemes: DirectorDashboardThemeDto[];
  hotEntities: DirectorDashboardEntityDto[];
  openQuestions: DirectorDashboardOpenQuestionDto[];
  narrativeSummary: NarrativeSummaryDto | null;
  kpiSentimentIndex: DirectorDashboardKpiDto;
  kpiCommitmentReliability: DirectorDashboardKpiDto;
  kpiHangingDecisions: DirectorDashboardKpiDto;
  strategicAlignment?: DirectorDashboardStrategicAlignmentDto;
  requiresAction?: DirectorDashboardRequiresActionDto;
  goalsTree?: DirectorDashboardGoalTreeNodeDto[];
  goalsPulse?: DirectorDashboardGoalsPulseDto;
  isEmpty: boolean;
  valueStrip: DirectorDashboardValueStripDto;
  mainReworkEnabled: boolean;
  degraded?: boolean;
}
