import { z } from 'zod';

import type { IdeaClusterDto } from '../../ideas/dto/ideas.dto';
import type { InsightListItemDto } from '../../insights/dto/insights.dto';

import type {
  OperationsDashboardBlockerDto,
  OperationsDashboardTeamFrictionDto,
} from './operations-dashboard.dto';

export interface MonthlyDigestMetricsDto {
  weeksCount: number;
  missingWeeks: string[];
  avgGreenShare: number;
  avgRedShare: number;
  totalCheckIns: number;
  goalsCompleted: number;
  goalsFailed: number;
  topBlockers: Array<{ text: string; count: number }>;
  tasksDone: number;
  tasksPlanned: number;
  tasksNotDone: number;
  ownerForks?: Array<{ title: string; why: string }>;
  nextFocus?: Array<{ title: string; why: string }>;
  risksSummary?: string | null;
  ideasSummary?: string | null;
  risksByCause?: InsightListItemDto[];
  ideaClusters?: IdeaClusterDto[];
  teamFrictions?: OperationsDashboardTeamFrictionDto[];
  blockers?: OperationsDashboardBlockerDto[];
}

export interface MonthlyDigestSourcesDto {
  weeklyDigestIds: string[];
  goalIds: string[];
}

export interface MonthlyDigestVerdictAxisDto {
  key: 'team' | 'clients' | 'execution' | 'overall';
  state: 'ok' | 'warn' | 'risk';
  label: string;
  why: string;
}

export interface MonthlyDigestVerdictDto {
  overall: { state: 'ok' | 'warn' | 'risk'; emoji: string; title: string; oneLiner: string };
  axes: MonthlyDigestVerdictAxisDto[];
}

export interface MonthlyDigestLetterSectionDto {
  key: string;
  title: string;
  prose: string;
  cites?: Array<{ label: string; ref: string }>;
}

export interface MonthlyDigestPaceDto {
  factToGoal: number | null;
  planToGoal: number | null;
  etaIso: string | null;
  leadingSignal: string | null;
}

export interface MonthlyDigestGoalAlignmentMonthDto {
  direction: 'to_goal' | 'drift' | 'against';
  score: number | null;
  monthDelta: string;
  pace: MonthlyDigestPaceDto;
  why: string;
  pro: string[];
  contra: string[];
  goalId?: string | null;
  goalName?: string | null;
}

export type MonthWeekTrendState = 'ok' | 'warn' | 'risk' | 'none';

export interface MonthWeekTrendAxisDto {
  key: 'team' | 'clients' | 'execution' | 'overall';
  weeks: Array<{ weekStart: string; state: MonthWeekTrendState }>;
}

export interface MonthlyOperationsDigestDto {
  id: string;
  tenantId: string;
  periodYm: string;
  bodyMarkdown: string;
  metrics: MonthlyDigestMetricsDto;
  sources: MonthlyDigestSourcesDto;
  llmTaskRouteId: string | null;
  createdAt: string;
  shortSummary?: string | null;
  deliveredAt?: string | null;
  verdict?: MonthlyDigestVerdictDto | null;
  letter?: MonthlyDigestLetterSectionDto[] | null;
  goalAlignmentMonth?: MonthlyDigestGoalAlignmentMonthDto | null;
  weekTrend?: MonthWeekTrendAxisDto[] | null;
}

export const MonthlyDigestQuerySchema = z
  .object({ period: z.string().regex(/^\d{4}-\d{2}$/, 'period должен быть YYYY-MM') })
  .strict();
export type MonthlyDigestQuery = z.infer<typeof MonthlyDigestQuerySchema>;
