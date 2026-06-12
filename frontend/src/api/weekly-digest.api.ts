import { apiClient } from './api-client';

/**
 * SBA β-8.1 — API-клиент недельной сводки операционного директора.
 *
 *   GET  /api/v1/dashboard/operations/weekly-digest?weekStart=YYYY-MM-DD
 *   POST /api/v1/dashboard/operations/weekly-digest/generate?weekStart=YYYY-MM-DD
 *
 * Доступ: coo/owner/admin (см. `RbacService.canViewOperationsDashboard`).
 * Принудительная регенерация — только admin/owner.
 */

export interface WeeklyDigestMetricsApi {
  totalCheckIns: number;
  greenShare: number;
  yellowShare: number;
  redShare: number;
  topBlockers: Array<{ text: string; count: number }>;
  topInsights: Array<{
    insightId: string;
    statement: string;
    kind: string;
    dynamicLabel: string;
  }>;
  // ТЗ-2 Ф3 — топ-идеи недели (производятся backend).
  topIdeas?: Array<{
    ideaId: string;
    statement: string;
    status: string;
    weight: number;
    supporterCount: number;
  }>;
  goals: {
    completed: number;
    failed: number;
    inProgress: number;
    completedDelta: number;
    failedDelta: number;
  };
  hangingDecisions: Array<{
    decisionId: string;
    statement: string;
    ageDays: number;
  }>;
}

export interface WeeklyDigestSourcesApi {
  blockerCheckInIds: string[];
  insightIds: string[];
  goalIds: string[];
  decisionIds: string[];
}

/**
 * Pulse Wave 2 §2.2 — Дельта одного KPI текущая_неделя vs предыдущая.
 * Зеркало `WeeklyKpiDeltaDto` в backend.
 */
export interface WeeklyKpiDeltaApi {
  label: string;
  current: number;
  previous: number | null;
  delta: number | null;
  unit: '%' | 'pts' | 'шт';
}

/** Pulse Wave 2 §2.2 — Динамика команды по health-метрикам. */
export interface WeeklyTeamDynamicsRowApi {
  departmentId: string;
  departmentName: string;
  signal:
    | 'sentiment_improved'
    | 'sentiment_dropped'
    | 'promises_improved'
    | 'promises_dropped';
  detail: string;
}

/** Pulse Wave 2 §2.2 — Прогноз по KPI на следующую неделю. */
export interface WeeklyForecastItemApi {
  metric: 'sentiment' | 'promises' | 'hanging_decisions';
  projection: string;
  confidence: 'low' | 'medium';
}

/**
 * ТЗ-2 Ф3 — дельта секции «текущая неделя vs предыдущая».
 * `previous`/`delta` равны null, когда сравнивать не с чем.
 */
export interface WeeklyDeltaApi {
  current: number;
  previous: number | null;
  delta: number | null;
}

/**
 * Ф1b редизайна дашбордов — точка исторического тренда (зеркало backend
 * `WeeklyDigestTrendPointDto`). Считается из persisted-снимков metricsJson.
 */
export interface WeeklyDigestTrendPointApi {
  weekStart: string;
  totalCheckIns: number;
  greenShare: number;
  redShare: number;
  goalsCompleted: number;
  goalsFailed: number;
  blockers: number;
  hangingDecisions: number;
}

export interface WeeklyOperationsDigestApi {
  id: string;
  tenantId: string;
  weekStart: string;
  weekEnd: string;
  bodyMarkdown: string;
  metrics: WeeklyDigestMetricsApi;
  sources: WeeklyDigestSourcesApi;
  llmTaskRouteId: string | null;
  createdAt: string;
  // Pulse Wave 2 §2.2 — расширенные секции (runtime-вычислены на backend).
  kpiDeltas: WeeklyKpiDeltaApi[];
  teamDynamics: WeeklyTeamDynamicsRowApi[];
  forecast: WeeklyForecastItemApi[];
  // ТЗ-2 Ф3 — дельты по разделам (блокеры / сигналы / идеи) неделя к неделе.
  sectionDeltas: {
    blockers: WeeklyDeltaApi;
    insights: WeeklyDeltaApi;
    ideas: WeeklyDeltaApi;
  };
  // Ф1b — исторический тренд (runtime из persisted-снимков на backend), old→new.
  trend: WeeklyDigestTrendPointApi[];
}

export const weeklyDigestApi = {
  get: (weekStart: string) =>
    apiClient.get<WeeklyOperationsDigestApi>(
      `/api/v1/dashboard/operations/weekly-digest?weekStart=${weekStart}`,
    ),
  generate: (weekStart: string) =>
    apiClient.post<WeeklyOperationsDigestApi>(
      `/api/v1/dashboard/operations/weekly-digest/generate?weekStart=${weekStart}`,
      undefined,
    ),
};
