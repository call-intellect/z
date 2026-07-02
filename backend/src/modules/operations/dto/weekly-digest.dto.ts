import { z } from 'zod';

import type { IdeaClusterDto } from '../../ideas/dto/ideas.dto';
import type { InsightListItemDto } from '../../insights/dto/insights.dto';

import type {
  OperationsDashboardBlockerDto,
  OperationsDashboardTeamFrictionDto,
} from './operations-dashboard.dto';

export interface WeeklyDigestMetricsDto {
  totalCheckIns: number;
  greenShare: number;
  yellowShare: number;
  redShare: number;
  topBlockers: Array<{ text: string; count: number }>;
  topInsights: Array<{ insightId: string; statement: string; kind: string; dynamicLabel: string }>;
  goals: {
    completed: number;
    failed: number;
    inProgress: number;
    completedDelta: number;
    failedDelta: number;
  };
  topIdeas?: Array<{
    ideaId: string;
    statement: string;
    status: string;
    weight: number;
    supporterCount: number;
  }>;
  risksSummary?: string | null;
  ideasSummary?: string | null;
  risksByCause?: InsightListItemDto[];
  ideaClusters?: IdeaClusterDto[];
  teamFrictions?: OperationsDashboardTeamFrictionDto[];
  blockers?: OperationsDashboardBlockerDto[];
}

export interface WeeklyDigestSourcesDto {
  blockerCheckInIds: string[];
  insightIds: string[];
  goalIds: string[];
  ideaIds?: string[];
}

export interface WeeklyKpiDeltaDto {
  label: string;
  current: number;
  previous: number | null;
  delta: number | null;
  unit: '%' | 'pts' | 'шт';
}

export interface WeeklyTeamDynamicsRowDto {
  departmentId: string;
  departmentName: string;
  signal: 'sentiment_improved' | 'sentiment_dropped';
  detail: string;
}

export interface WeeklyForecastItemDto {
  metric: 'sentiment';
  projection: string;
  confidence: 'low' | 'medium';
}

export interface WeeklyDeltaDto {
  current: number;
  previous: number | null;
  delta: number | null;
}

export interface WeeklySectionDeltasDto {
  blockers: WeeklyDeltaDto;
  insights: WeeklyDeltaDto;
  ideas: WeeklyDeltaDto;
}

export interface WeeklyDigestTrendPointDto {
  weekStart: string;
  totalCheckIns: number;
  greenShare: number;
  redShare: number;
  goalsCompleted: number;
  goalsFailed: number;
  blockers: number;
}

export interface WeeklyDigestVerdictAxisDto {
  key: 'team' | 'clients' | 'execution' | 'overall';
  state: 'ok' | 'warn' | 'risk';
  label: string;
  why: string;
}

export interface WeeklyDigestVerdictDto {
  overall: { state: 'ok' | 'warn' | 'risk'; emoji: string; title: string; oneLiner: string };
  axes: WeeklyDigestVerdictAxisDto[];
}

export interface WeeklyDigestLetterSectionDto {
  key: string;
  title: string;
  prose: string;
  cites?: Array<{ label: string; ref: string }>;
}

export interface WeeklyDigestGoalAlignmentWeekDto {
  direction: 'to_goal' | 'drift' | 'against';
  score: number | null;
  weekDelta: string;
  why: string;
  pro: string[];
  contra: string[];
  goalId?: string | null;
  goalName?: string | null;
}

export type WeeklyDayTrendState = 'ok' | 'warn' | 'risk' | 'none';

export interface WeeklyDayTrendAxisDto {
  key: 'team' | 'clients' | 'execution' | 'overall';
  days: Array<{ dateLocal: string; state: WeeklyDayTrendState }>;
}

export interface WeeklyOperationsDigestDto {
  id: string;
  tenantId: string;
  weekStart: string;
  weekEnd: string;
  bodyMarkdown: string;
  metrics: WeeklyDigestMetricsDto;
  sources: WeeklyDigestSourcesDto;
  llmTaskRouteId: string | null;
  createdAt: string;
  kpiDeltas: WeeklyKpiDeltaDto[];
  teamDynamics: WeeklyTeamDynamicsRowDto[];
  forecast: WeeklyForecastItemDto[];
  sectionDeltas: WeeklySectionDeltasDto;
  trend: WeeklyDigestTrendPointDto[];
  verdict?: WeeklyDigestVerdictDto | null;
  letter?: WeeklyDigestLetterSectionDto[] | null;
  goalAlignmentWeek?: WeeklyDigestGoalAlignmentWeekDto | null;
  dayTrend?: WeeklyDayTrendAxisDto[] | null;
}

export const WeeklyDigestQuerySchema = z
  .object({
    weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'weekStart должен быть YYYY-MM-DD'),
  })
  .strict();

export type WeeklyDigestQuery = z.infer<typeof WeeklyDigestQuerySchema>;

export const TeamTemperatureQuerySchema = z
  .object({
    days: z.coerce.number().int().min(1).max(90).default(7),
  })
  .strict();

export type TeamTemperatureQuery = z.infer<typeof TeamTemperatureQuerySchema>;
