import { z } from 'zod';

export const ConciergeOverviewQuerySchema = z.object({
  period: z.enum(['day', 'week', 'month']).default('week'),
});
export type ConciergeOverviewQueryDto = z.infer<typeof ConciergeOverviewQuerySchema>;

export const ConciergeTopQueriesQuerySchema = z.object({
  period: z.enum(['day', 'week', 'month']).default('week'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ConciergeTopQueriesQueryDto = z.infer<typeof ConciergeTopQueriesQuerySchema>;

export const ConciergeNoAnswerQuerySchema = z.object({
  period: z.enum(['day', 'week', 'month']).default('week'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ConciergeNoAnswerQueryDto = z.infer<typeof ConciergeNoAnswerQuerySchema>;
