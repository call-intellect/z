import { z } from 'zod';

export const KnowledgeProfileConfidenceSchema = z.enum(['low', 'medium', 'high']);
export type KnowledgeProfileConfidenceDto = z.infer<typeof KnowledgeProfileConfidenceSchema>;

export interface KnowledgeProfileSampleStatementDto {
  quote: string;
  blockId: string;
  sourceUrl?: string | null;
}

export interface KnowledgeProfileCategoryDto {
  name: string;
  confidence: KnowledgeProfileConfidenceDto;
  observationCount: number;
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
  version: number;
  builtAt: string;
  isEmpty: boolean;
  categories: KnowledgeProfileCategoryDto[];
  experienceHighlights: KnowledgeProfileHighlightDto[];
  isSelf: boolean;
}

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
