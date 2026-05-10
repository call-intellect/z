import { z } from 'zod';

/**
 * DTO для admin usage endpoints (Z-Admin + Org-Admin, Фаза 7).
 *
 * Используется обоими контроллерами:
 *   - `/api/v1/admin/usage/*` (super_admin, scope=global).
 *   - `/api/v1/org-admin/usage/*` (owner/admin, scope=org).
 *
 * Период: `day | week | month | custom`. При `custom` — `from/to` обязательны.
 */

export const PeriodSchema = z.enum(['day', 'week', 'month', 'custom']);
export type AdminPeriod = z.infer<typeof PeriodSchema>;

export const DashboardQuerySchema = z
  .object({
    period: PeriodSchema.default('week'),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .refine(
    (v) =>
      v.period !== 'custom' || (v.from !== undefined && v.to !== undefined),
    {
      message: 'period=custom требует from и to',
    },
  );
export type DashboardQuery = z.infer<typeof DashboardQuerySchema>;

export const UsersUsageQuerySchema = z
  .object({
    period: PeriodSchema.default('week'),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    cursor: z.string().optional(),
    search: z.string().min(1).max(100).optional(),
  })
  .refine(
    (v) =>
      v.period !== 'custom' || (v.from !== undefined && v.to !== undefined),
    { message: 'period=custom требует from и to' },
  );
export type UsersUsageQuery = z.infer<typeof UsersUsageQuerySchema>;

export const CallsLogQuerySchema = z.object({
  taskType: z.string().min(1).max(100).optional(),
  userId: z.string().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
  experimentGroup: z.enum(['A', 'B']).optional(),
});
export type CallsLogQuery = z.infer<typeof CallsLogQuerySchema>;

export const FunctionsUsageQuerySchema = z
  .object({
    period: PeriodSchema.default('week'),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .refine(
    (v) =>
      v.period !== 'custom' || (v.from !== undefined && v.to !== undefined),
    { message: 'period=custom требует from и to' },
  );
export type FunctionsUsageQuery = z.infer<typeof FunctionsUsageQuerySchema>;

export const FunctionCallsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
export type FunctionCallsQuery = z.infer<typeof FunctionCallsQuerySchema>;

export const ExportCsvQuerySchema = z
  .object({
    period: PeriodSchema.default('week'),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    kind: z.enum(['calls', 'users', 'functions']).default('calls'),
  })
  .refine(
    (v) =>
      v.period !== 'custom' || (v.from !== undefined && v.to !== undefined),
    { message: 'period=custom требует from и to' },
  );
export type ExportCsvQuery = z.infer<typeof ExportCsvQuerySchema>;
