import type {
  MonthWeekTrendAxisApi,
  MonthlyDigestGoalAlignmentMonthApi,
  MonthlyDigestLetterSectionApi,
  MonthlyDigestMetricsApi,
  MonthlyDigestSourcesApi,
  MonthlyDigestVerdictApi,
  MonthlyOperationsDigestApi,
} from "@/api/monthly-digest.api";

export interface MonthlyDigestMetricsDomain extends MonthlyDigestMetricsApi {}

export interface MonthlyDigestSourcesDomain extends MonthlyDigestSourcesApi {}

export interface MonthlyDigestDomain {
  id: string;
  tenantId: string;
  periodYm: string;
  bodyMarkdown: string;
  metrics: MonthlyDigestMetricsDomain;
  sources: MonthlyDigestSourcesDomain;
  llmTaskRouteId: string | null;
  createdAt: Date;
  shortSummary: string | null;
  deliveredAt: Date | null;
  verdict: MonthlyDigestVerdictApi | null;
  letter: MonthlyDigestLetterSectionApi[] | null;
  goalAlignmentMonth: MonthlyDigestGoalAlignmentMonthApi | null;
  weekTrend: MonthWeekTrendAxisApi[] | null;
}

export function fromMonthlyDigestApi(
  dto: MonthlyOperationsDigestApi,
): MonthlyDigestDomain {
  return {
    id: dto.id,
    tenantId: dto.tenantId,
    periodYm: dto.periodYm,
    bodyMarkdown: dto.bodyMarkdown,
    metrics: dto.metrics,
    sources: dto.sources,
    llmTaskRouteId: dto.llmTaskRouteId ?? null,
    createdAt: new Date(dto.createdAt),
    shortSummary: dto.shortSummary ?? null,
    deliveredAt: dto.deliveredAt ? new Date(dto.deliveredAt) : null,
    verdict: dto.verdict ?? null,
    letter: dto.letter ?? null,
    goalAlignmentMonth: dto.goalAlignmentMonth ?? null,
    weekTrend: dto.weekTrend ?? null,
  };
}
