import { z } from 'zod';

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
  hangingDecisions: Array<{ decisionId: string; statement: string; ageDays: number }>;
  topIdeas?: Array<{
    ideaId: string;
    statement: string;
    status: string;
    weight: number;
    supporterCount: number;
  }>;
}

export interface WeeklyDigestSourcesDto {
  blockerCheckInIds: string[];
  insightIds: string[];
  goalIds: string[];
  decisionIds: string[];
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
  signal: 'sentiment_improved' | 'sentiment_dropped' | 'promises_improved' | 'promises_dropped';
  detail: string;
}

export interface WeeklyForecastItemDto {
  metric: 'sentiment' | 'promises' | 'hanging_decisions';
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
  hangingDecisions: number;
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
