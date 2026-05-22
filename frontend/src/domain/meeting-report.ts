/**
 * DomainModel для MeetingReport (Фаза E §7).
 *
 * См. `frontend-rules`: ApiDto (`src/api/meeting-reports.api`) →
 * DomainModel (этот файл) → UiModel (компоненты вкладки «Отчёты»).
 */

import type {
  AvailableTemplateApi,
  MeetingReportStatusApi,
  ReportDetailApi,
  ReportKindApi,
  ReportListItemApi,
} from '@/api/meeting-reports.api';

export type ReportStatus = MeetingReportStatusApi;
export type ReportKind = ReportKindApi;

export interface ReportListItemDomain {
  kind: ReportKind;
  id: string;
  meetingId: string;
  templateId: string | null;
  templateName: string;
  status: ReportStatus;
  outputPreview: string | null;
  /** ISO -> Date. */
  createdAt: Date;
  completedAt: Date | null;
  llmCostUsd: number | null;
  llmDurationMs: number | null;
  errorMessage: string | null;
}

export interface ReportDetailDomain extends ReportListItemDomain {
  output: unknown | null;
  promptTemplateVersionId: string | null;
}

export interface AvailableTemplateDomain {
  id: string;
  scope: 'system' | 'org';
  name: string;
  description: string | null;
  meetingType: string | null;
  taskType: string;
}

export function reportListItemFromApi(api: ReportListItemApi): ReportListItemDomain {
  return {
    kind: api.kind,
    id: api.id,
    meetingId: api.meetingId,
    templateId: api.templateId,
    templateName: api.templateName,
    status: api.status,
    outputPreview: api.outputPreview,
    createdAt: new Date(api.createdAt),
    completedAt: api.completedAt ? new Date(api.completedAt) : null,
    llmCostUsd: api.llmCostUsd,
    llmDurationMs: api.llmDurationMs,
    errorMessage: api.errorMessage,
  };
}

export function reportDetailFromApi(api: ReportDetailApi): ReportDetailDomain {
  return {
    ...reportListItemFromApi(api),
    output: api.output,
    promptTemplateVersionId: api.promptTemplateVersionId,
  };
}

export function availableTemplateFromApi(
  api: AvailableTemplateApi,
): AvailableTemplateDomain {
  return {
    id: api.id,
    scope: api.scope,
    name: api.name,
    description: api.description,
    meetingType: api.meetingType,
    taskType: api.taskType,
  };
}

/** Человеческий русский label статуса для UI. */
export function reportStatusLabel(status: ReportStatus): string {
  switch (status) {
    case 'pending':
      return 'В очереди';
    case 'running':
      return 'Подготовка отчёта…';
    case 'ready':
      return 'Готов';
    case 'failed':
      return 'Не удалось сгенерировать';
    case 'archived':
      return 'В архиве';
  }
}

/** Есть ли в списке хоть один отчёт в работе → нужно polling. */
export function hasInProgress(items: ReportListItemDomain[]): boolean {
  return items.some((r) => r.status === 'pending' || r.status === 'running');
}
