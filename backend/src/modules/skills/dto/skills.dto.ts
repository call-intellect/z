import { z } from 'zod';

const NameSchema = z
  .string({ error: 'Название компетенции обязательно' })
  .trim()
  .min(1, 'Название не может быть пустым')
  .max(200, 'Название не длиннее 200 символов');

const DescriptionSchema = z
  .string()
  .trim()
  .max(5000, 'Описание не длиннее 5000 символов')
  .nullable()
  .optional();

export const ListSkillsQuerySchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  includeDeleted: z.coerce.boolean().optional().default(false),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export type ListSkillsQuery = z.infer<typeof ListSkillsQuerySchema>;

export const CreateSkillSchema = z.object({
  name: NameSchema,
  description: DescriptionSchema,
});
export type CreateSkillDto = z.infer<typeof CreateSkillSchema>;

export const UpdateSkillSchema = z
  .object({
    name: NameSchema.optional(),
    description: DescriptionSchema,
  })
  .refine(
    (data) => Object.values(data).some((v) => v !== undefined),
    { message: 'Хотя бы одно поле должно быть указано' },
  );
export type UpdateSkillDto = z.infer<typeof UpdateSkillSchema>;

export const BatchCreateSkillsSchema = z.object({
  items: z.array(CreateSkillSchema).min(1).max(200),
});
export type BatchCreateSkillsDto = z.infer<typeof BatchCreateSkillsSchema>;

export interface SkillListItemDto {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export type SkillDto = SkillListItemDto;
