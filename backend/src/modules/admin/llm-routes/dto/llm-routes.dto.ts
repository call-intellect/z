import { z } from 'zod';

import { ALL_LLM_TASK_TYPES } from '../../../ai/services/llm-router.service';

const PROVIDER_NAMES = [
  'anthropic',
  'minimax',
  'openai-via-proxy',
  'deepseek',
  'ollama',
  'kie',
  'grsai',
] as const;

export const TASK_TYPES_TUPLE = ALL_LLM_TASK_TYPES;

export const PutLlmRouteSchema = z.object({
  providers: z
    .array(
      z.object({
        provider: z.enum(PROVIDER_NAMES),
        model: z.string().min(1).max(100).optional(),
      }),
    )
    .min(1)
    .max(10),
  isActive: z.boolean(),
  pinnedVersionNote: z.string().max(2000).nullable().optional(),
});

export type PutLlmRouteDto = z.infer<typeof PutLlmRouteSchema>;
