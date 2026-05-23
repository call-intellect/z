import { z } from 'zod';

/**
 * DTO модуля Experiments (SBA β-6). REST API `/api/v1/experiments` —
 * институциональная память «что попробовали и что вышло».
 *
 * Под капотом — Prisma-модели `Experiment` + `ExperimentVersion` (β-6 §5).
 * Все user-facing строки на русском.
 */

export const ExperimentStatusSchema = z.enum([
  'hypothesis',
  'running',
  'completed',
  'dropped',
  'paused',
]);
export type ExperimentStatusDto = z.infer<typeof ExperimentStatusSchema>;

export const ExperimentLessonTypeSchema = z.enum([
  'what_worked',
  'what_failed',
  'next_time',
]);
export type ExperimentLessonTypeDto = z.infer<
  typeof ExperimentLessonTypeSchema
>;

// ─────────────────────── Query / Filters ─────────────────────────────

export const ListExperimentsQuerySchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  status: ExperimentStatusSchema.optional(),
  owner_entity_id: z.string().min(1).max(60).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListExperimentsQuery = z.infer<typeof ListExperimentsQuerySchema>;

// ─────────────────────── Bodies ──────────────────────────────────────

export const CreateExperimentBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  hypothesisText: z.string().trim().min(1).max(4_000),
  ownerEntityId: z.string().min(1).max(60).optional(),
  status: ExperimentStatusSchema.optional(),
  sourceBlockIds: z.array(z.string().min(1).max(60)).max(50).optional(),
});
export type CreateExperimentBody = z.infer<typeof CreateExperimentBodySchema>;

export const UpdateExperimentBodySchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  hypothesisText: z.string().trim().min(1).max(4_000).optional(),
  ownerEntityId: z.string().min(1).max(60).nullable().optional(),
  currentResult: z.string().trim().min(1).max(4_000).nullable().optional(),
  lessons: z
    .array(
      z.object({
        text: z.string().min(1).max(1_000),
        type: ExperimentLessonTypeSchema,
        sourceBlockId: z.string().min(1).max(60).optional(),
      }),
    )
    .max(50)
    .optional(),
});
export type UpdateExperimentBody = z.infer<typeof UpdateExperimentBodySchema>;

export const TransitionExperimentBodySchema = z.object({
  to: z.enum(['running', 'completed', 'dropped', 'paused']),
  reason: z.string().trim().min(1).max(2_000).optional(),
});
export type TransitionExperimentBody = z.infer<
  typeof TransitionExperimentBodySchema
>;

// ─────────────────────── Response DTOs ───────────────────────────────

export interface ExperimentLessonDto {
  text: string;
  type: ExperimentLessonTypeDto;
  sourceBlockId: string | null;
}

export interface ExperimentListItemDto {
  id: string;
  name: string;
  hypothesisText: string;
  status: ExperimentStatusDto;
  ownerEntityId: string | null;
  currentResult: string | null;
  lessonsCount: number;
  startedAt: string | null;
  completedAt: string | null;
  confidence: number;
  sourceBlocksCount: number;
  updatedAt: string;
  createdAt: string;
}

export interface ExperimentDetailDto extends ExperimentListItemDto {
  lessons: ExperimentLessonDto[];
  sourceBlockIds: string[];
  personSubjectIds: string[];
  entityId: string | null;
  currentVersionId: string | null;
  lastConfirmedAt: string | null;
}

export interface ListExperimentsResponse {
  items: ExperimentListItemDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
