import { z } from 'zod';

export const EXPERIMENT_STATUSES = ['draft', 'running', 'stopped', 'completed'] as const;
export type ExperimentStatus = (typeof EXPERIMENT_STATUSES)[number];

export const ListPromptExperimentsQuerySchema = z.object({
  status: z.enum(EXPERIMENT_STATUSES).optional(),
  orgId: z.string().min(1).max(60).nullable().optional(),
});
export type ListPromptExperimentsQueryDto = z.infer<typeof ListPromptExperimentsQuerySchema>;

export const CreatePromptExperimentSchema = z.object({
  orgId: z.string().min(1).max(60).nullable().optional(),
  templateAId: z.string().min(1).max(60),
  templateBId: z.string().min(1).max(60),
  splitPercent: z.number().int().min(0).max(100),
  endsAt: z.string().datetime().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});
export type CreatePromptExperimentDto = z.infer<typeof CreatePromptExperimentSchema>;

export const StopPromptExperimentSchema = z.object({
  reason: z.string().max(500).optional(),
});
export type StopPromptExperimentDto = z.infer<typeof StopPromptExperimentSchema>;

export const AnalyticsQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
export type AnalyticsQueryDto = z.infer<typeof AnalyticsQuerySchema>;
