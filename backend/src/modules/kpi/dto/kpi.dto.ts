import { z } from 'zod';

export const KPI_FREQUENCIES = ['daily', 'weekly', 'monthly', 'quarterly', 'adhoc'] as const;
export type KpiFrequency = (typeof KPI_FREQUENCIES)[number];

export const METRIC_VALUE_TYPES = ['count', 'ratio', 'duration_seconds', 'money', 'other'] as const;
export type MetricValueTypeLiteral = (typeof METRIC_VALUE_TYPES)[number];

const FrequencySchema = z.enum(KPI_FREQUENCIES);
const ValueTypeSchema = z.enum(METRIC_VALUE_TYPES);

export const ListKpiQuerySchema = z.object({
  attachedToRoleId: z.string().min(1).optional(),
  attachedToDepartmentId: z.string().min(1).optional(),
  attachedToResponsibilityElementId: z.string().min(1).optional(),
  frequency: FrequencySchema.optional(),
  kpiOnly: z.coerce.boolean().optional().default(true),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export type ListKpiQuery = z.infer<typeof ListKpiQuerySchema>;

const NameSchema = z
  .string({ error: 'Имя KPI обязательно' })
  .trim()
  .min(1, 'Имя не может быть пустым')
  .max(200);

const UnitSchema = z.string().trim().min(1, 'Единица измерения обязательна').max(50);

export const CreateKpiSchema = z
  .object({
    name: NameSchema,
    description: z.string().max(2000).nullable().optional(),
    unit: UnitSchema,
    target: z.coerce.number().finite().nullable().optional(),
    valueType: ValueTypeSchema.optional(),
    attachedToRoleId: z.string().min(1).nullable().optional(),
    attachedToDepartmentId: z.string().min(1).nullable().optional(),
    attachedToResponsibilityElementId: z.string().min(1).nullable().optional(),
    frequency: FrequencySchema.nullable().optional(),
  })
  .refine(
    (data) =>
      Boolean(
        data.attachedToRoleId ??
        data.attachedToDepartmentId ??
        data.attachedToResponsibilityElementId,
      ),
    {
      message:
        'Хотя бы одно из attachedToRoleId / attachedToDepartmentId / attachedToResponsibilityElementId должно быть заполнено',
    },
  );
export type CreateKpiDto = z.infer<typeof CreateKpiSchema>;

export const UpdateKpiSchema = z
  .object({
    name: NameSchema.optional(),
    description: z.string().max(2000).nullable().optional(),
    unit: UnitSchema.optional(),
    target: z.coerce.number().finite().nullable().optional(),
    valueType: ValueTypeSchema.optional(),
    attachedToRoleId: z.string().min(1).nullable().optional(),
    attachedToDepartmentId: z.string().min(1).nullable().optional(),
    attachedToResponsibilityElementId: z.string().min(1).nullable().optional(),
    frequency: FrequencySchema.nullable().optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'Хотя бы одно поле должно быть указано',
  });
export type UpdateKpiDto = z.infer<typeof UpdateKpiSchema>;

export const KpiMeasurementSchema = z.object({
  currentValue: z.coerce.number().finite({
    error: 'currentValue обязателен и должен быть конечным числом',
  }),
  currentValueUnit: z.string().trim().min(1).max(50).optional(),
  measuredAt: z.coerce.date().optional(),
});
export type KpiMeasurementDto = z.infer<typeof KpiMeasurementSchema>;

export interface KpiDto {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  unit: string;
  target: number | null;
  valueType: MetricValueTypeLiteral;
  attachedToRoleId: string | null;
  attachedToDepartmentId: string | null;
  attachedToResponsibilityElementId: string | null;
  currentValue: number | null;
  currentValueUnit: string | null;
  lastMeasuredAt: string | null;
  frequency: KpiFrequency | null;
  createdAt: string;
  updatedAt: string;
}
