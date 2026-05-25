import { z } from 'zod';

/**
 * DTO модуля Departments (Фаза 0a — структура компании, группа А).
 *
 * Валидируется `ZodValidationPipe`. Все строки русские (frontend-rules:
 * админка пользователя — только русский язык).
 */

// ─────────────────────────── Common pieces ───────────────────────────

const NameSchema = z
  .string({ error: 'Название отдела обязательно' })
  .trim()
  .min(1, 'Название отдела не может быть пустым')
  .max(200, 'Название отдела не длиннее 200 символов');

// ─────────────────────────── Query / Filters ─────────────────────────

export const ListDepartmentsQuerySchema = z.object({
  /** Поиск по подстроке в названии (ILIKE). */
  q: z.string().trim().min(1).max(200).optional(),
  /** Показывать ли soft-deleted записи (default false). */
  includeDeleted: z.coerce.boolean().optional().default(false),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export type ListDepartmentsQuery = z.infer<typeof ListDepartmentsQuerySchema>;

// ─────────────────────────── Body ────────────────────────────────────

export const CreateDepartmentSchema = z.object({
  name: NameSchema,
  parentDepartmentId: z.string().min(1).nullable().optional(),
});
export type CreateDepartmentDto = z.infer<typeof CreateDepartmentSchema>;

export const UpdateDepartmentSchema = z
  .object({
    name: NameSchema.optional(),
    parentDepartmentId: z.string().min(1).nullable().optional(),
  })
  .refine(
    (data) => Object.values(data).some((v) => v !== undefined),
    { message: 'Хотя бы одно поле должно быть указано' },
  );
export type UpdateDepartmentDto = z.infer<typeof UpdateDepartmentSchema>;

export const BatchCreateDepartmentsSchema = z.object({
  items: z
    .array(CreateDepartmentSchema)
    .min(1, 'Список не должен быть пустым')
    .max(200, 'За один запрос можно создать не более 200 отделов'),
});
export type BatchCreateDepartmentsDto = z.infer<typeof BatchCreateDepartmentsSchema>;

/**
 * ТЗ 2026-05-25 «clone-reliability-hardening» Фаза 3 — назначение/снятие
 * главы отдела. `headPersonId === null` снимает главу. Person должен
 * принадлежать той же Org, иметь `relationship='employee'` и быть активным.
 */
export const SetDepartmentHeadSchema = z.object({
  headPersonId: z.string().min(1).nullable(),
});
export type SetDepartmentHeadDto = z.infer<typeof SetDepartmentHeadSchema>;

// ─────────────────────────── Response DTO ────────────────────────────

export interface DepartmentListItemDto {
  id: string;
  name: string;
  parentDepartmentId: string | null;
  /** Person.id главы отдела, либо null если не назначен. */
  headPersonId: string | null;
  rolesCount: number;
  childrenCount: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface DepartmentDto extends DepartmentListItemDto {}
