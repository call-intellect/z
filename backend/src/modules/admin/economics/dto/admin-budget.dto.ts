import { z } from 'zod';

/**
 * SBA α-10 wave 3 — DTO для /api/v1/admin/orgs/:id/budget +
 * /api/v1/admin/unit-economics +
 * /api/v1/org/economics.
 */
export const UpdateOrgBudgetSchema = z.object({
  monthlyCapRub: z.number().nonnegative().nullable(),
  capKind: z.enum(['soft', 'hard']).default('soft'),
  alertThresholds: z
    .array(z.number().int().positive().max(1000))
    .min(1)
    .default([50, 80, 95]),
});
export type UpdateOrgBudgetDto = z.infer<typeof UpdateOrgBudgetSchema>;

export const UnitEconomicsGlobalQuerySchema = z.object({
  days: z.coerce.number().int().positive().max(365).default(30),
  topN: z.coerce.number().int().positive().max(100).default(10),
});
export type UnitEconomicsGlobalQuery = z.infer<
  typeof UnitEconomicsGlobalQuerySchema
>;

export const UnitEconomicsOrgQuerySchema = z.object({
  days: z.coerce.number().int().positive().max(365).default(30),
});
export type UnitEconomicsOrgQuery = z.infer<
  typeof UnitEconomicsOrgQuerySchema
>;
