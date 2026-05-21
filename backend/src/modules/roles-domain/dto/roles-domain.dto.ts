import { z } from 'zod';

/**
 * DTO модуля бизнес-должностей (Role).
 *
 * Внимание: модель Prisma `Role` — это «бизнес-должность» компании клиента,
 * НЕ путать с `MembershipRole` (owner/admin/manager — права доступа в Z).
 * Поэтому модуль называется `roles-domain`, URL — `/api/v1/roles`.
 */

const NameSchema = z
  .string({ error: 'Название должности обязательно' })
  .trim()
  .min(1, 'Название должности не может быть пустым')
  .max(200, 'Название должности не длиннее 200 символов');

const TagsSchema = z
  .array(z.string().trim().min(1).max(50))
  .max(20, 'Не более 20 тегов на должность');

// ─────────────────────────── Query / Filters ─────────────────────────

export const ListRolesQuerySchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  departmentId: z.string().min(1).optional(),
  includeDeleted: z.coerce.boolean().optional().default(false),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export type ListRolesQuery = z.infer<typeof ListRolesQuerySchema>;

// ─────────────────────────── Body ────────────────────────────────────

export const CreateRoleSchema = z.object({
  name: NameSchema,
  departmentId: z.string().min(1).nullable().optional(),
  tags: TagsSchema.optional(),
});
export type CreateRoleDto = z.infer<typeof CreateRoleSchema>;

export const UpdateRoleSchema = z
  .object({
    name: NameSchema.optional(),
    departmentId: z.string().min(1).nullable().optional(),
    tags: TagsSchema.optional(),
  })
  .refine(
    (data) => Object.values(data).some((v) => v !== undefined),
    { message: 'Хотя бы одно поле должно быть указано' },
  );
export type UpdateRoleDto = z.infer<typeof UpdateRoleSchema>;

export const BatchCreateRolesSchema = z.object({
  items: z
    .array(CreateRoleSchema)
    .min(1, 'Список не должен быть пустым')
    .max(200, 'За один запрос можно создать не более 200 должностей'),
});
export type BatchCreateRolesDto = z.infer<typeof BatchCreateRolesSchema>;

// ─────────────────────────── Response DTO ────────────────────────────

export interface RoleListItemDto {
  id: string;
  name: string;
  departmentId: string | null;
  departmentName: string | null;
  tags: string[];
  personsCount: number;
  jobDescriptionsCount: number;
  roleProfileStatus: 'forming' | 'ready' | 'stale' | 'error' | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface RoleDto extends RoleListItemDto {}
