import { z } from 'zod';

export const SkillTraitConceptStatusSchema = z.enum(['active', 'merged_into', 'archived']);
export type SkillTraitConceptStatus = z.infer<typeof SkillTraitConceptStatusSchema>;

export const ListSkillTraitConceptsQuerySchema = z.object({
  status: SkillTraitConceptStatusSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  q: z.string().trim().min(1).max(200).optional(),
});
export type ListSkillTraitConceptsQueryDto = z.infer<typeof ListSkillTraitConceptsQuerySchema>;

export const MergeSkillTraitConceptSchema = z.object({
  targetId: z.string().min(1, 'Не указан целевой смысловой блок'),
  reason: z
    .string()
    .min(3, 'Укажите причину слияния (минимум 3 символа)')
    .max(500, 'Причина слишком длинная (максимум 500 символов)'),
});
export type MergeSkillTraitConceptDto = z.infer<typeof MergeSkillTraitConceptSchema>;

export const ArchiveSkillTraitConceptSchema = z.object({
  reason: z
    .string()
    .min(3, 'Укажите причину архивации (минимум 3 символа)')
    .max(500, 'Причина слишком длинная (максимум 500 символов)'),
});
export type ArchiveSkillTraitConceptDto = z.infer<typeof ArchiveSkillTraitConceptSchema>;

export interface SkillTraitConceptListItemDto {
  id: string;
  canonicalName: string;
  description: string | null;
  variants: string[];
  status: SkillTraitConceptStatus;
  mergedIntoId: string | null;
  traitCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface SkillTraitConceptDetailDto extends SkillTraitConceptListItemDto {
  recentTraits: Array<{
    id: string;
    category: string;
    statement: string;
    confidence: string;
    profileId: string;
    personName: string | null;
    lastConfirmedAt: string;
  }>;
}
