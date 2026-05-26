import { z } from 'zod';

/**
 * DTO модуля Persons (Фаза 0a — структура компании, группа А).
 *
 * `Person` — сотрудник компании клиента. НЕ путать с `Entity{type=person}`
 * (упоминание персоны в графе знаний knowledge-core, который висит на
 * `/api/v1/knowledge/entities?type=person`). Этот модуль — для ЛК Org.
 */

const NameSchema = z
  .string({ error: 'Имя сотрудника обязательно' })
  .trim()
  .min(1, 'Имя сотрудника не может быть пустым')
  .max(200, 'Имя сотрудника не длиннее 200 символов');

const EmailSchema = z
  .string({ error: 'Email обязателен' })
  .trim()
  .toLowerCase()
  .email('Невалидный email')
  .max(320);

// ─────────────────────────── Query / Filters ─────────────────────────

export const ListPersonsQuerySchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  departmentId: z.string().min(1).optional(),
  roleId: z.string().min(1).optional(),
  /** Фильтр по статусу приглашения (по последнему OrgInvitation на этого Person). */
  invitationStatus: z
    .enum(['pending', 'accepted', 'revoked', 'expired', 'none'])
    .optional(),
  includeDeleted: z.coerce.boolean().optional().default(false),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export type ListPersonsQuery = z.infer<typeof ListPersonsQuerySchema>;

// ─────────────────────────── Body ────────────────────────────────────

export const CreatePersonSchema = z.object({
  name: NameSchema,
  email: EmailSchema,
  /** Назначение в отдел (UI: основной отдел). */
  primaryDepartmentId: z.string().min(1).nullable().optional(),
  /** Опционально: сразу создать PersonRole. */
  roleId: z.string().min(1).nullable().optional(),
});
export type CreatePersonDto = z.infer<typeof CreatePersonSchema>;

export const UpdatePersonSchema = z
  .object({
    name: NameSchema.optional(),
    email: EmailSchema.optional(),
    primaryDepartmentId: z.string().min(1).nullable().optional(),
    /** Назначить новую должность; старая закрывается (validTo=now). */
    roleId: z.string().min(1).nullable().optional(),
  })
  .refine(
    (data) => Object.values(data).some((v) => v !== undefined),
    { message: 'Хотя бы одно поле должно быть указано' },
  );
export type UpdatePersonDto = z.infer<typeof UpdatePersonSchema>;

export const BatchCreatePersonsSchema = z.object({
  items: z
    .array(CreatePersonSchema)
    .min(1, 'Список не должен быть пустым')
    .max(200, 'За один запрос можно создать не более 200 сотрудников'),
});
export type BatchCreatePersonsDto = z.infer<typeof BatchCreatePersonsSchema>;

/**
 * Calendar MVP (2026-05-25) Фаза P4 — Quick-create контакта прямо из
 * EventForm.ParticipantPicker. Минимально необходимый набор полей: name
 * (обязательно), email/phone опц. Дубль-защита по (tenantId, email) на
 * стороне сервиса.
 */
export const QuickCreatePersonSchema = z.object({
  name: NameSchema,
  email: EmailSchema.optional(),
  phone: z
    .string()
    .trim()
    .min(1)
    .max(64, 'Телефон не длиннее 64 символов')
    .optional(),
});
export type QuickCreatePersonDto = z.infer<typeof QuickCreatePersonSchema>;

export interface QuickCreatePersonResponseDto {
  personId: string;
  name: string;
  email: string | null;
}

// ─────────────────────────── Response DTO ────────────────────────────

export interface PersonListItemDto {
  id: string;
  name: string;
  email: string;
  userId: string | null;
  primaryDepartmentId: string | null;
  primaryDepartmentName: string | null;
  currentRoleId: string | null;
  currentRoleName: string | null;
  invitationStatus: 'pending' | 'accepted' | 'revoked' | 'expired' | 'none';
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export type PersonDto = PersonListItemDto;
