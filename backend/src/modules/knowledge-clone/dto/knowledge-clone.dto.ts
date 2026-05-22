import { z } from 'zod';

/**
 * SBA β-2 — DTO модуля knowledge-clone (Specialist 3.2).
 *
 * Все user-facing строки — на русском. Структура соответствует
 * `SerializedKnowledgeProfile` из `specialist-3-2-knowledge-clone.service.ts`.
 */

export const KnowledgeProfileConfidenceSchema = z.enum([
  'low',
  'medium',
  'high',
]);
export type KnowledgeProfileConfidenceDto = z.infer<
  typeof KnowledgeProfileConfidenceSchema
>;

export interface KnowledgeProfileSampleStatementDto {
  quote: string;
  blockId: string;
  /** URL источника (если получится разрешить blockId → meeting/document). */
  sourceUrl?: string | null;
}

export interface KnowledgeProfileCategoryDto {
  name: string;
  confidence: KnowledgeProfileConfidenceDto;
  observationCount: number;
  /** Может быть пустым для member-доступа (member видит только сводку). */
  sampleStatements: KnowledgeProfileSampleStatementDto[];
  relatedEntityIds: string[];
  lastObservedAt: string;
}

export interface KnowledgeProfileHighlightDto {
  summary: string;
  blockIds: string[];
}

export interface KnowledgeProfileDto {
  personId: string;
  personName: string;
  /** profileBuildVersion. */
  version: number;
  /** ISO-строка lastProfileBuildAt (либо builtAt из payload). */
  builtAt: string;
  /** True, если профиль ещё не построен (нет ни одной категории). */
  isEmpty: boolean;
  categories: KnowledgeProfileCategoryDto[];
  experienceHighlights: KnowledgeProfileHighlightDto[];
  /**
   * Если true — текущий пользователь сам носитель этого профиля
   * (используется во фронте, чтобы показать кнопку «помечу неверным»).
   */
  isSelf: boolean;
}

// ─────────────────────────── mark-wrong ─────────────────────────

export const MarkWrongBodySchema = z.object({
  categoryName: z
    .string()
    .trim()
    .min(2, 'Укажите название области, которое вы считаете неверным')
    .max(200),
  reason: z
    .string()
    .trim()
    .min(5, 'Опишите, почему вы считаете эту область неверной (минимум 5 символов)')
    .max(2_000),
});
export type MarkWrongBody = z.infer<typeof MarkWrongBodySchema>;

export interface MarkWrongResponseDto {
  ok: true;
  curationItemId: string;
}
