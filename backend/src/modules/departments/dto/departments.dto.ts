import { z } from 'zod';

const NameSchema = z
  .string({ error: 'Название отдела обязательно' })
  .trim()
  .min(1, 'Название отдела не может быть пустым')
  .max(200, 'Название отдела не длиннее 200 символов');

export const ListDepartmentsQuerySchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  includeDeleted: z.coerce.boolean().optional().default(false),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export type ListDepartmentsQuery = z.infer<typeof ListDepartmentsQuerySchema>;

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
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'Хотя бы одно поле должно быть указано',
  });
export type UpdateDepartmentDto = z.infer<typeof UpdateDepartmentSchema>;

export const BatchCreateDepartmentsSchema = z.object({
  items: z
    .array(CreateDepartmentSchema)
    .min(1, 'Список не должен быть пустым')
    .max(200, 'За один запрос можно создать не более 200 отделов'),
});
export type BatchCreateDepartmentsDto = z.infer<typeof BatchCreateDepartmentsSchema>;

export const SetDepartmentHeadSchema = z.object({
  headPersonId: z.string().min(1).nullable(),
});
export type SetDepartmentHeadDto = z.infer<typeof SetDepartmentHeadSchema>;

export const MergeDepartmentSchema = z.object({
  intoId: z.string({ error: 'Не указан отдел-приёмник' }).trim().min(1, 'Не указан отдел-приёмник'),
});
export type MergeDepartmentDto = z.infer<typeof MergeDepartmentSchema>;

export interface DepartmentListItemDto {
  id: string;
  name: string;
  parentDepartmentId: string | null;
  headPersonId: string | null;
  rolesCount: number;
  childrenCount: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export type DepartmentDto = DepartmentListItemDto;

export interface MergeDepartmentResultDto {
  ok: true;
  target: DepartmentDto;
  moved: {
    roles: number;
    appointments: number;
    projects: number;
    persons: number;
    childDepartments: number;
    domainLinks: number;
    metrics: number;
    interactions: number;
    orgUnits: number;
    entity: number;
  };
}
