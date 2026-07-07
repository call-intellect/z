import { z } from 'zod';

export const PeriodSchema = z.enum(['day', 'week', 'month', 'custom']);
export type AdminPeriod = z.infer<typeof PeriodSchema>;

function csvArray(maxLen: number) {
  return z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined;
      const arr = Array.isArray(v) ? v : v.split(',');
      const cleaned = arr.map((s) => s.trim()).filter((s) => s.length > 0 && s.length <= maxLen);
      return cleaned.length > 0 ? cleaned : undefined;
    });
}

export const DashboardQuerySchema = z
  .object({
    period: PeriodSchema.default('week'),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    provider: csvArray(60),
    model: csvArray(120),
    taskType: csvArray(80),
    orgId: csvArray(100),
  })
  .refine((v) => v.period !== 'custom' || (v.from !== undefined && v.to !== undefined), {
    message: 'period=custom требует from и to',
  });
export type DashboardQuery = z.infer<typeof DashboardQuerySchema>;

export const CallsLogQuerySchema = z.object({
  taskType: z.string().min(1).max(100).optional(),
  userId: z.string().min(1).max(100).optional(),
  meetingId: z.string().min(1).optional(),
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
  .refine((v) => v.period !== 'custom' || (v.from !== undefined && v.to !== undefined), {
    message: 'period=custom требует from и to',
  });
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
    kind: z.enum(['calls']).default('calls'),
  })
  .refine((v) => v.period !== 'custom' || (v.from !== undefined && v.to !== undefined), {
    message: 'period=custom требует from и to',
  });
export type ExportCsvQuery = z.infer<typeof ExportCsvQuerySchema>;
