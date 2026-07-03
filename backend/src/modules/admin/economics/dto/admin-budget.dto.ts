import { z } from 'zod';

export const UpdateOrgBudgetSchema = z.object({
  monthlyCapRub: z.number().nonnegative().nullable(),
  capKind: z.enum(['soft', 'hard']).default('soft'),
  alertThresholds: z.array(z.number().int().positive().max(1000)).min(1).default([50, 80, 95]),
});
export type UpdateOrgBudgetDto = z.infer<typeof UpdateOrgBudgetSchema>;

export const UnitEconomicsOrgQuerySchema = z.object({
  days: z.coerce.number().int().positive().max(365).default(30),
});
export type UnitEconomicsOrgQuery = z.infer<typeof UnitEconomicsOrgQuerySchema>;

export const AggregateUnitEconomicsBodySchema = z
  .object({
    date: z.string().datetime({ offset: true }).optional(),
  })
  .strict();
export type AggregateUnitEconomicsBody = z.infer<typeof AggregateUnitEconomicsBodySchema>;
