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
