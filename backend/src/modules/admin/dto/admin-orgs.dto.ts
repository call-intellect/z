import { z } from 'zod';

import { PeriodSchema } from './admin-usage.dto';

export const ListOrgsQuerySchema = z
  .object({
    period: PeriodSchema.default('month'),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    search: z.string().min(1).max(100).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    cursor: z.string().optional(),
    includeDeleted: z
      .union([z.boolean(), z.string()])
      .transform((v) => (typeof v === 'boolean' ? v : v === 'true' || v === '1'))
      .default(false),
  })
  .refine((v) => v.period !== 'custom' || (v.from !== undefined && v.to !== undefined), {
    message: 'period=custom требует from и to',
  });
export type ListOrgsQuery = z.infer<typeof ListOrgsQuerySchema>;

export const UpdateOrgSchema = z
  .object({
    tier: z.enum(['basic', 'pro', 'enterprise']).optional(),
    freeze: z.boolean().optional(),
  })
  .refine((v) => v.freeze !== undefined, {
    message: 'необходимо указать freeze',
  });
export type UpdateOrgDto = z.infer<typeof UpdateOrgSchema>;
