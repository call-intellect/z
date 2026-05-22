import { z } from 'zod';

/**
 * DTO модуля Insights (SBA β-4). REST API `/api/v1/insights` — реестр
 * повторяющихся проблем / рисков / блокеров / неэффективностей компании.
 *
 * Под капотом — Prisma-таблица `insights` (см. β-4 sub-TZ §4).
 * Все user-facing строки — на русском.
 */

export const InsightKindSchema = z.enum([
  'problem',
  'risk',
  'blocker',
  'inefficiency',
]);
export type InsightKindDto = z.infer<typeof InsightKindSchema>;

export const InsightSeveritySchema = z.enum([
  'low',
  'medium',
  'high',
  'critical',
]);
export type InsightSeverityDto = z.infer<typeof InsightSeveritySchema>;

export const InsightDynamicSchema = z.enum([
  'growing',
  'stable',
  'declining',
  'spike',
]);
export type InsightDynamicDto = z.infer<typeof InsightDynamicSchema>;

export const InsightStatusSchema = z.enum([
  'active',
  'mitigating',
  'mitigated',
  'archived',
  'false_alarm',
]);
export type InsightStatusDto = z.infer<typeof InsightStatusSchema>;

// ─────────────────────────── Query / Filters ─────────────────────────

export const ListInsightsQuerySchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  kind: InsightKindSchema.optional(),
  severity: InsightSeveritySchema.optional(),
  status: InsightStatusSchema.optional(),
  dynamic_label: InsightDynamicSchema.optional(),
  affected_entity_id: z.string().min(1).max(60).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListInsightsQuery = z.infer<typeof ListInsightsQuerySchema>;

export const ChartInsightsQuerySchema = z.object({
  days: z.coerce.number().int().min(7).max(180).default(30),
});
export type ChartInsightsQuery = z.infer<typeof ChartInsightsQuerySchema>;

export const TopInsightsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(20).default(5),
});
export type TopInsightsQuery = z.infer<typeof TopInsightsQuerySchema>;

export const ChangeInsightStatusBodySchema = z.object({
  newStatus: InsightStatusSchema,
  reason: z.string().min(1).max(2_000).optional(),
});
export type ChangeInsightStatusBody = z.infer<
  typeof ChangeInsightStatusBodySchema
>;

export const SetMitigationBodySchema = z.object({
  mitigationPlan: z.string().min(1).max(8_000),
});
export type SetMitigationBody = z.infer<typeof SetMitigationBodySchema>;

export const ChangeSeverityBodySchema = z.object({
  newSeverity: InsightSeveritySchema,
  reason: z.string().min(1).max(2_000).optional(),
});
export type ChangeSeverityBody = z.infer<typeof ChangeSeverityBodySchema>;

// ─────────────────────────── Response DTOs ───────────────────────────

export interface InsightListItemDto {
  id: string;
  kind: InsightKindDto;
  statement: string;
  severity: InsightSeverityDto;
  status: InsightStatusDto;
  dynamicLabel: InsightDynamicDto;
  frequencyScore: number;
  dynamicScore: number;
  affectedEntityIds: string[];
  relatedDecisionIds: string[];
  firstObservedAt: string;
  lastObservedAt: string;
  sourceBlocksCount: number;
  confidence: number;
  updatedAt: string;
  createdAt: string;
}

export interface InsightDetailDto extends InsightListItemDto {
  mitigationPlan: string | null;
  sourceBlockIds: string[];
  personSubjectIds: string[];
  currentVersionId: string | null;
  dataClass: string;
}

export interface ListInsightsResponse {
  items: InsightListItemDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface InsightsChartResponse {
  /** Метки временных бакетов (ISO дата начала недели). */
  labels: string[];
  /** Серии: одна серия на каждый kind, value — count за неделю. */
  series: Array<{
    kind: InsightKindDto;
    counts: number[];
  }>;
}

export interface TopInsightsResponse {
  items: InsightListItemDto[];
}
