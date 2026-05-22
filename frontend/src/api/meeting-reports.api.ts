/**
 * API DTO для /api/v1/meetings/:id/reports (Фаза E §7).
 *
 * Источник правды — backend/src/modules/meeting-reports/.
 * Слой ApiDto. Domain-маппер живёт в `src/domain/meeting-report.ts`.
 */

import { apiClient } from './api-client';

export const MEETING_REPORT_STATUSES = [
  'pending',
  'running',
  'ready',
  'failed',
  'archived',
] as const;
export type MeetingReportStatusApi = (typeof MEETING_REPORT_STATUSES)[number];

export type ReportKindApi = 'primary' | 'additional';

export type ReportListItemApi = {
  kind: ReportKindApi;
  id: string;
  meetingId: string;
  templateId: string | null;
  templateName: string;
  status: MeetingReportStatusApi;
  outputPreview: string | null;
  createdAt: string;
  completedAt: string | null;
  llmCostUsd: number | null;
  llmDurationMs: number | null;
  errorMessage: string | null;
};

export type ReportDetailApi = ReportListItemApi & {
  output: unknown | null;
  promptTemplateVersionId: string | null;
};

export type AvailableTemplateApi = {
  id: string;
  scope: 'system' | 'org';
  name: string;
  description: string | null;
  meetingType: string | null;
  taskType: string;
};

export const meetingReportsApi = {
  list: (meetingId: string) =>
    apiClient.get<ReportListItemApi[]>(
      `/api/v1/meetings/${encodeURIComponent(meetingId)}/reports`,
    ),

  availableTemplates: (meetingId: string) =>
    apiClient.get<AvailableTemplateApi[]>(
      `/api/v1/meetings/${encodeURIComponent(meetingId)}/reports/templates`,
    ),

  create: (meetingId: string, templateId: string) =>
    apiClient.post<{ id: string; status: MeetingReportStatusApi }>(
      `/api/v1/meetings/${encodeURIComponent(meetingId)}/reports`,
      { templateId },
    ),

  detail: (meetingId: string, reportId: string) =>
    apiClient.get<ReportDetailApi>(
      `/api/v1/meetings/${encodeURIComponent(meetingId)}/reports/${encodeURIComponent(reportId)}`,
    ),

  regenerate: (meetingId: string, reportId: string, body?: { useVersionId?: string }) =>
    apiClient.post<{ id: string; status: MeetingReportStatusApi }>(
      `/api/v1/meetings/${encodeURIComponent(meetingId)}/reports/${encodeURIComponent(reportId)}/regenerate`,
      body ?? {},
    ),

  remove: (meetingId: string, reportId: string) =>
    apiClient.del<void>(
      `/api/v1/meetings/${encodeURIComponent(meetingId)}/reports/${encodeURIComponent(reportId)}`,
    ),
};
