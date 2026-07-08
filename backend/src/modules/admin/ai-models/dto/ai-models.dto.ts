import { z } from 'zod';

import { ALL_LLM_TASK_TYPES } from '../../../ai/services/llm-router.service';

export const PROVIDER_NAMES = [
  'anthropic',
  'minimax',
  'openai-via-proxy',
  'deepseek',
  'ollama',
  'kie',
  'grsai',
] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number];

export const TIER_VALUES = ['primary', 'secondary', 'tertiary'] as const;
export type TierValue = (typeof TIER_VALUES)[number];

export const TASK_TYPES_TUPLE = ALL_LLM_TASK_TYPES;

export const ListAiModelsQuerySchema = z.object({
  group: z.enum(['ai-pipeline', 'knowledge-core', 'competitor-parity']).optional(),
  search: z.string().min(1).max(60).optional(),
});
export type ListAiModelsQueryDto = z.infer<typeof ListAiModelsQuerySchema>;

export const SwitchPrimarySchema = z.object({
  providerName: z.enum(PROVIDER_NAMES),
  model: z.string().min(1).max(120),
  abSplitPercent: z.number().int().min(0).max(100).optional(),
  abDurationDays: z.number().int().min(1).max(30).optional(),
  reason: z.string().min(3).max(500),
});
export type SwitchPrimaryDto = z.infer<typeof SwitchPrimarySchema>;

export const AddProviderSchema = z.object({
  tier: z.enum(TIER_VALUES),
  providerName: z.enum(PROVIDER_NAMES),
  model: z.string().min(1).max(120),
  priority: z.number().int().min(0).max(99).optional(),
  reason: z.string().min(3).max(500).optional(),
});
export type AddProviderDto = z.infer<typeof AddProviderSchema>;

export const CreateExperimentSchema = z.object({
  taskType: z.string().refine((v) => (TASK_TYPES_TUPLE as readonly string[]).includes(v), {
    message: 'Unknown taskType',
  }),
  controlModel: z.string().min(1).max(120),
  controlProvider: z.enum(PROVIDER_NAMES),
  variantModel: z.string().min(1).max(120),
  variantProvider: z.enum(PROVIDER_NAMES),
  splitPercent: z.number().int().min(1).max(99),
  durationDays: z.number().int().min(1).max(30),
  notes: z.string().max(2000).optional(),
});
export type CreateExperimentDto = z.infer<typeof CreateExperimentSchema>;

export const MetricsQuerySchema = z.object({
  period: z.enum(['24h', '7d', '30d']).optional().default('7d'),
});
export type MetricsQueryDto = z.infer<typeof MetricsQuerySchema>;

export const BulkReassignScopeSchema = z.object({
  scope: z.enum(['unassigned', 'provider']),
  tier: z.enum(TIER_VALUES).optional(),
  fromProviderName: z.string().optional(),
});

function requireFromProviderForScopeProvider(
  v: { scope: 'unassigned' | 'provider'; fromProviderName?: string },
  ctx: z.RefinementCtx,
): void {
  if (v.scope === 'provider' && !v.fromProviderName) {
    ctx.addIssue({
      code: 'custom',
      message: 'fromProviderName обязателен при scope="provider"',
      path: ['fromProviderName'],
    });
  }
}

export const BulkReassignPreviewSchema = BulkReassignScopeSchema.superRefine(
  requireFromProviderForScopeProvider,
);
export type BulkReassignPreviewDto = z.infer<typeof BulkReassignPreviewSchema>;

export const BulkReassignSchema = BulkReassignScopeSchema.extend({
  toProviderName: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .max(60),
  toModel: z.string().min(1).max(120),
  reason: z.string().min(3).max(500),
}).superRefine(requireFromProviderForScopeProvider);
export type BulkReassignDto = z.infer<typeof BulkReassignSchema>;

export const PutChainSchema = z.object({
  entries: z
    .array(
      z.object({
        tier: z.enum(TIER_VALUES),
        providerName: z
          .string()
          .regex(/^[a-z0-9-]+$/)
          .max(60),
        model: z.string().max(120).nullable().optional(),
        priority: z.number().int().min(0).default(0),
      }),
    )
    .min(1)
    .max(10),
  isActive: z.boolean().default(true),
  pinnedVersionNote: z.string().max(2000).nullable().optional(),
  reason: z.string().min(3).max(500),
});
export type PutChainDto = z.infer<typeof PutChainSchema>;
