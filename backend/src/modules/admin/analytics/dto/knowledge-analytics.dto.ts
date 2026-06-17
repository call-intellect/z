import { z } from 'zod';

export const KnowledgeOverviewQuerySchema = z.object({
  period: z.enum(['day', 'week', 'month']).default('week'),
});
export type KnowledgeOverviewQueryDto = z.infer<typeof KnowledgeOverviewQuerySchema>;

export const KnowledgeByOrgQuerySchema = z.object({
  period: z.enum(['day', 'week', 'month']).default('week'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type KnowledgeByOrgQueryDto = z.infer<typeof KnowledgeByOrgQuerySchema>;

export const KnowledgeGrowthQuerySchema = z.object({
  period: z.enum(['week', 'month']).default('week'),
});
export type KnowledgeGrowthQueryDto = z.infer<typeof KnowledgeGrowthQuerySchema>;
