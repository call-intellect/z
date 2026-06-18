import { z } from 'zod';

export const APPOINTMENT_STATUSES = ['active', 'former', 'acting'] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

const StatusSchema = z.enum(APPOINTMENT_STATUSES);

export const ListAppointmentsQuerySchema = z.object({
  personId: z.string().min(1).optional(),
  roleId: z.string().min(1).optional(),
  departmentId: z.string().min(1).optional(),
  status: StatusSchema.optional(),
  activeOnly: z.coerce.boolean().optional().default(false),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export type ListAppointmentsQuery = z.infer<typeof ListAppointmentsQuerySchema>;

export const CreateAppointmentSchema = z.object({
  personId: z.string().min(1, 'personId обязателен'),
  roleId: z.string().min(1, 'roleId обязателен'),
  departmentId: z.string().min(1).nullable().optional(),
  loadPercent: z.coerce.number().int().min(1).max(200).optional(),
  status: StatusSchema.optional(),
  validFrom: z.coerce.date().optional(),
  validTo: z.coerce.date().nullable().optional(),
});
export type CreateAppointmentDto = z.infer<typeof CreateAppointmentSchema>;

export const UpdateAppointmentSchema = z
  .object({
    departmentId: z.string().min(1).nullable().optional(),
    loadPercent: z.coerce.number().int().min(1).max(200).optional(),
    status: StatusSchema.optional(),
    validFrom: z.coerce.date().optional(),
    validTo: z.coerce.date().nullable().optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'Хотя бы одно поле должно быть указано',
  });
export type UpdateAppointmentDto = z.infer<typeof UpdateAppointmentSchema>;

export interface AppointmentDto {
  id: string;
  tenantId: string;
  personId: string;
  personName: string | null;
  roleId: string;
  roleName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  loadPercent: number;
  status: AppointmentStatus;
  validFrom: string;
  validTo: string | null;
  sourceBlockIds: string[];
  confidence: number;
  createdAt: string;
  updatedAt: string;
}

export interface AppointmentTimelineItemDto extends AppointmentDto {
  durationDays: number | null;
}
