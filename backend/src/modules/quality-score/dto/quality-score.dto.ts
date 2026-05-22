/**
 * DTO для quality-score API (Фаза C §7).
 *
 * Источник: plans/tz/2026-05-21-phase-C-meeting-quality-score.md §7.
 *
 * Zod-схема → класс через `nestjs-zod`. Используется в контроллере + Swagger.
 */

import { MeetingType } from '@prisma/client';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// ─────────────────────── meeting-level quality score ───────────────────────

export const QualityScoreStatusSchema = z.enum([
  'pending',
  'ready',
  'failed',
  'disabled',
]);
export type QualityScoreStatus = z.infer<typeof QualityScoreStatusSchema>;

const CategorySchema = z.enum([
  'preparation',
  'structure',
  'clarity',
  'outcomes',
  'engagement',
]);
const SeveritySchema = z.enum(['info', 'warning', 'critical']);

export const QualityScoreRecommendationSchema = z.object({
  text: z.string(),
  severity: SeveritySchema,
  category: CategorySchema,
  /** true, если LLM работал на tertiary (Ollama) и точность ниже (sub-TZ C §5.4). */
  degradedMode: z.boolean().optional(),
});

export const QualityScoreCategoriesSchema = z.object({
  preparation: z.number().int().min(0).max(100),
  structure: z.number().int().min(0).max(100),
  clarity: z.number().int().min(0).max(100),
  outcomes: z.number().int().min(0).max(100),
  engagement: z.number().int().min(0).max(100),
});

export const QualityScoreResponseSchema = z.object({
  status: QualityScoreStatusSchema,
  /** null если status != 'ready'. */
  score: z
    .object({
      overallScore: z.number().int().min(0).max(100),
      categories: QualityScoreCategoriesSchema,
      recommendations: z.array(QualityScoreRecommendationSchema),
      strengths: z.array(z.string()),
      computedAt: z.string().datetime(),
      degradedMode: z.boolean(),
    })
    .nullable(),
});
export type QualityScoreResponse = z.infer<typeof QualityScoreResponseSchema>;
export class QualityScoreResponseDto extends createZodDto(QualityScoreResponseSchema) {}

// ─────────────────────── regenerate ───────────────────────

export const RegenerateQualityScoreResponseSchema = z.object({
  status: z.literal('queued'),
  meetingId: z.string(),
});
export type RegenerateQualityScoreResponse = z.infer<typeof RegenerateQualityScoreResponseSchema>;
export class RegenerateQualityScoreResponseDto extends createZodDto(
  RegenerateQualityScoreResponseSchema,
) {}

// ─────────────────────── Org settings ───────────────────────

export const UpdateQualityScoreSettingsBodySchema = z.object({
  disabledForTypes: z.array(z.nativeEnum(MeetingType)),
});
export type UpdateQualityScoreSettingsBody = z.infer<typeof UpdateQualityScoreSettingsBodySchema>;
export class UpdateQualityScoreSettingsBodyDto extends createZodDto(
  UpdateQualityScoreSettingsBodySchema,
) {}

export const OrgQualityScoreSettingsResponseSchema = z.object({
  disabledForTypes: z.array(z.nativeEnum(MeetingType)),
});
export type OrgQualityScoreSettingsResponse = z.infer<
  typeof OrgQualityScoreSettingsResponseSchema
>;
export class OrgQualityScoreSettingsResponseDto extends createZodDto(
  OrgQualityScoreSettingsResponseSchema,
) {}

// ─────────────────────── dashboard aggregate ───────────────────────

export const OrgDashboardQualityScoreQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  meetingType: z.nativeEnum(MeetingType).optional(),
});
export type OrgDashboardQualityScoreQuery = z.infer<
  typeof OrgDashboardQualityScoreQuerySchema
>;

export const OrgDashboardQualityScoreByTypeSchema = z.object({
  type: z.nativeEnum(MeetingType),
  avg: z.number(),
  count: z.number().int().nonnegative(),
});

export const OrgDashboardQualityScoreTrendPointSchema = z.object({
  date: z.string(),
  avg: z.number(),
  count: z.number().int().nonnegative(),
});

export const OrgDashboardQualityScoreResponseSchema = z.object({
  averageScore: z.number(),
  meetingsCount: z.number().int().nonnegative(),
  byType: z.array(OrgDashboardQualityScoreByTypeSchema),
  trend: z.array(OrgDashboardQualityScoreTrendPointSchema),
});
export type OrgDashboardQualityScoreResponse = z.infer<
  typeof OrgDashboardQualityScoreResponseSchema
>;
export class OrgDashboardQualityScoreResponseDto extends createZodDto(
  OrgDashboardQualityScoreResponseSchema,
) {}
