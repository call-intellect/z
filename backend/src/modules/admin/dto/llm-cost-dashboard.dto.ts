import { z } from 'zod';

export const LlmCostPeriodSchema = z.enum(['7d', '30d', '90d']).default('30d');
export type LlmCostPeriod = z.infer<typeof LlmCostPeriodSchema>;

export const LlmCostTrendGranularitySchema = z.enum(['day', 'week']).default('day');
export type LlmCostTrendGranularity = z.infer<typeof LlmCostTrendGranularitySchema>;

export const LlmCostOverviewQuerySchema = z.object({
  period: LlmCostPeriodSchema,
  trend: LlmCostTrendGranularitySchema,
});
export type LlmCostOverviewQuery = z.infer<typeof LlmCostOverviewQuerySchema>;

export const LlmCostModelQuerySchema = LlmCostOverviewQuerySchema;
export type LlmCostModelQuery = z.infer<typeof LlmCostModelQuerySchema>;

export const LlmCostModuleQuerySchema = LlmCostOverviewQuerySchema;
export type LlmCostModuleQuery = z.infer<typeof LlmCostModuleQuerySchema>;

export const LlmCostCompaniesQuerySchema = z.object({
  period: LlmCostPeriodSchema,
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
  search: z.string().optional(),
});
export type LlmCostCompaniesQuery = z.infer<typeof LlmCostCompaniesQuerySchema>;

export const LlmCostCompanyDetailQuerySchema = LlmCostOverviewQuerySchema;
export type LlmCostCompanyDetailQuery = z.infer<typeof LlmCostCompanyDetailQuerySchema>;

export const LlmCostTaskTypeQuerySchema = LlmCostOverviewQuerySchema;
export type LlmCostTaskTypeQuery = z.infer<typeof LlmCostTaskTypeQuerySchema>;
