import { z } from 'zod';

const NameSchema = z
  .string({ error: 'Название категории обязательно' })
  .trim()
  .min(1, 'Название не может быть пустым')
  .max(200, 'Название не длиннее 200 символов');

const DescriptionSchema = z
  .string()
  .trim()
  .max(2000, 'Описание не длиннее 2000 символов')
  .nullable()
  .optional();

export const ListSkillTraitCategoriesQuerySchema = z.object({
  parentCategoryId: z.string().trim().min(1).max(80).optional(),
  includeDeleted: z.coerce.boolean().optional().default(false),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export type ListSkillTraitCategoriesQuery = z.infer<typeof ListSkillTraitCategoriesQuerySchema>;

export const CreateSkillTraitCategorySchema = z.object({
  name: NameSchema,
  description: DescriptionSchema,
  parentCategoryId: z.string().trim().min(1).max(80).nullable().optional(),
});
export type CreateSkillTraitCategoryDto = z.infer<typeof CreateSkillTraitCategorySchema>;

export const UpdateSkillTraitCategorySchema = z
  .object({
    name: NameSchema.optional(),
    description: DescriptionSchema,
    parentCategoryId: z.string().trim().min(1).max(80).nullable().optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'Хотя бы одно поле должно быть указано',
  });
export type UpdateSkillTraitCategoryDto = z.infer<typeof UpdateSkillTraitCategorySchema>;

export const MergeSkillTraitCategoriesSchema = z
  .object({
    sourceId: z.string().trim().min(1).max(80),
    targetId: z.string().trim().min(1).max(80),
  })
  .refine((d) => d.sourceId !== d.targetId, {
    message: 'sourceId и targetId должны различаться',
  });
export type MergeSkillTraitCategoriesDto = z.infer<typeof MergeSkillTraitCategoriesSchema>;

export interface SkillTraitCategoryDto {
  id: string;
  tenantId: string;
  name: string;
  slug: string;
  description: string | null;
  parentCategoryId: string | null;
  traitsCount: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface MergeSkillTraitCategoriesResultDto {
  source: SkillTraitCategoryDto;
  target: SkillTraitCategoryDto;
  movedTraits: number;
}
