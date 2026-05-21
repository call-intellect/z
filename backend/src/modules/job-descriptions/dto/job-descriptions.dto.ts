import { z } from 'zod';

/**
 * DTO модуля JobDescription (Фаза 0a — declared-форма должности).
 */

const ContentSchema = z
  .string({ error: 'Содержимое инструкции обязательно' })
  .trim()
  .min(1, 'Содержимое не может быть пустым')
  .max(100_000, 'Содержимое не длиннее 100000 символов');

export const ListJobDescriptionsQuerySchema = z.object({
  roleId: z.string().min(1).optional(),
  includeDeleted: z.coerce.boolean().optional().default(false),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export type ListJobDescriptionsQuery = z.infer<
  typeof ListJobDescriptionsQuerySchema
>;

export const CreateJobDescriptionSchema = z.object({
  roleId: z.string().min(1, 'roleId обязателен'),
  contentMd: ContentSchema,
  sourceDocumentId: z.string().min(1).nullable().optional(),
});
export type CreateJobDescriptionDto = z.infer<typeof CreateJobDescriptionSchema>;

export const UpdateJobDescriptionSchema = z
  .object({
    contentMd: ContentSchema.optional(),
    sourceDocumentId: z.string().min(1).nullable().optional(),
  })
  .refine(
    (data) => Object.values(data).some((v) => v !== undefined),
    { message: 'Хотя бы одно поле должно быть указано' },
  );
export type UpdateJobDescriptionDto = z.infer<typeof UpdateJobDescriptionSchema>;

export const BatchCreateJobDescriptionsSchema = z.object({
  items: z
    .array(CreateJobDescriptionSchema)
    .min(1)
    .max(50, 'За один запрос можно создать не более 50 должностных инструкций'),
});
export type BatchCreateJobDescriptionsDto = z.infer<
  typeof BatchCreateJobDescriptionsSchema
>;

export interface JobDescriptionListItemDto {
  id: string;
  roleId: string;
  roleName: string;
  contentMd: string;
  sourceDocumentId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface JobDescriptionDto extends JobDescriptionListItemDto {}
