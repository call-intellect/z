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
