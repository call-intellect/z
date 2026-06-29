import type {
  WeeklyDayTrendAxisApi,
  WeeklyDeltaApi,
  WeeklyDigestGoalAlignmentWeekApi,
  WeeklyDigestLetterSectionApi,
  WeeklyDigestMetricsApi,
  WeeklyDigestSourcesApi,
  WeeklyDigestTrendPointApi,
  WeeklyDigestVerdictApi,
  WeeklyForecastItemApi,
  WeeklyKpiDeltaApi,
  WeeklyOperationsDigestApi,
  WeeklyTeamDynamicsRowApi,
} from "@/api/weekly-digest.api";

export interface WeeklyDigestMetricsDomain extends WeeklyDigestMetricsApi {}

export interface WeeklyDigestSourcesDomain extends WeeklyDigestSourcesApi {}

export interface WeeklyDigestDomain {
  id: string;
  tenantId: string;
  weekStart: string;
  weekEnd: string;
  bodyMarkdown: string;
  metrics: WeeklyDigestMetricsDomain;
  sources: WeeklyDigestSourcesDomain;
  llmTaskRouteId: string | null;
  createdAt: Date;
  kpiDeltas: WeeklyKpiDeltaApi[];
  teamDynamics: WeeklyTeamDynamicsRowApi[];
  forecast: WeeklyForecastItemApi[];
  sectionDeltas: {
    blockers: WeeklyDeltaApi;
    insights: WeeklyDeltaApi;
    ideas: WeeklyDeltaApi;
  };
  trend: WeeklyDigestTrendPointApi[];
  verdict: WeeklyDigestVerdictApi | null;
  letter: WeeklyDigestLetterSectionApi[] | null;
  goalAlignmentWeek: WeeklyDigestGoalAlignmentWeekApi | null;
  dayTrend: WeeklyDayTrendAxisApi[] | null;
}

export function fromWeeklyDigestApi(
  dto: WeeklyOperationsDigestApi,
): WeeklyDigestDomain {
  return {
    id: dto.id,
    tenantId: dto.tenantId,
    weekStart: dto.weekStart,
    weekEnd: dto.weekEnd,
    bodyMarkdown: dto.bodyMarkdown,
    metrics: dto.metrics,
    sources: dto.sources,
    llmTaskRouteId: dto.llmTaskRouteId ?? null,
    createdAt: new Date(dto.createdAt),
    kpiDeltas: dto.kpiDeltas ?? [],
    teamDynamics: dto.teamDynamics ?? [],
    forecast: dto.forecast ?? [],
    sectionDeltas: dto.sectionDeltas,
    trend: dto.trend ?? [],
    verdict: dto.verdict ?? null,
    letter: dto.letter ?? null,
    goalAlignmentWeek: dto.goalAlignmentWeek ?? null,
    dayTrend: dto.dayTrend ?? null,
  };
}
