/**
 * DTO для /api/v1/meetings/:id/reports (Фаза E §7).
 *
 * Источник правды — `plans/tz/2026-05-21-phase-E-multi-report-per-meeting.md`.
 *
 * Слой ApiDto (по `frontend-rules`): сюда же фронт импортирует типы запроса/ответа
 * через api-client.
 */

import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

// ────────────────────────── enums ──────────────────────────

export const MEETING_REPORT_STATUSES = [
  'pending',
  'running',
  'ready',
  'failed',
  'archived',
] as const;
export type MeetingReportStatusDto = (typeof MEETING_REPORT_STATUSES)[number];

export const REPORT_KINDS = ['primary', 'additional'] as const;
export type ReportKindDto = (typeof REPORT_KINDS)[number];

// ────────────────────────── DTO list-item ──────────────────────────

/**
 * Унифицированный элемент списка отчётов: primary (синтетически из AiResult)
 * и additional (из MeetingReport). ТЗ E §6.
 */
export interface ReportListItemDto {
  kind: ReportKindDto;
  id: string;
  meetingId: string;
  templateId: string | null;
  templateName: string;
  status: MeetingReportStatusDto | 'ready';
  outputPreview: string | null;
  createdAt: string;
  completedAt: string | null;
  llmCostUsd: number | null;
  llmDurationMs: number | null;
  errorMessage: string | null;
}

/** Полный отчёт (для GET /:reportId — с output). */
export interface ReportDetailDto extends ReportListItemDto {
  output: unknown | null;
  promptTemplateVersionId: string | null;
}

// ────────────────────────── Body schemas ──────────────────────────

export const CreateReportSchema = z.object({
  templateId: z.string().min(1, 'templateId обязателен'),
});
export type CreateReportBody = z.infer<typeof CreateReportSchema>;

export const RegenerateReportSchema = z.object({
  useVersionId: z.string().min(1).optional(),
});
export type RegenerateReportBody = z.infer<typeof RegenerateReportSchema>;

// ────────────────────────── Swagger DTO ──────────────────────────

export class ReportListItemSwagger implements ReportListItemDto {
  @ApiProperty({ enum: REPORT_KINDS }) kind!: ReportKindDto;
  @ApiProperty() id!: string;
  @ApiProperty() meetingId!: string;
  @ApiProperty({ nullable: true, type: String }) templateId!: string | null;
  @ApiProperty() templateName!: string;
  @ApiProperty({ enum: [...MEETING_REPORT_STATUSES] }) status!: MeetingReportStatusDto;
  @ApiProperty({ nullable: true, type: String }) outputPreview!: string | null;
  @ApiProperty() createdAt!: string;
  @ApiProperty({ nullable: true, type: String }) completedAt!: string | null;
  @ApiProperty({ nullable: true, type: Number }) llmCostUsd!: number | null;
  @ApiProperty({ nullable: true, type: Number }) llmDurationMs!: number | null;
  @ApiProperty({ nullable: true, type: String }) errorMessage!: string | null;
}

export class CreateReportBodySwagger implements CreateReportBody {
  @ApiProperty({ description: 'PromptTemplate.id (системный или Org-шаблон)' })
  templateId!: string;
}

export class RegenerateReportBodySwagger implements Partial<RegenerateReportBody> {
  @ApiProperty({ required: false, nullable: true, type: String })
  useVersionId?: string;
}
