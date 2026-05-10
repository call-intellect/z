import { z } from 'zod';

const PROVIDER_NAMES = [
  'anthropic',
  'minimax',
  'openai-via-proxy',
  'deepseek',
  'ollama',
] as const;
const TASK_TYPES = [
  'summary',
  'chapters',
  'tasks',
  'chat',
  'regenerate-section',
  'custom-prompt',
  'follow-up',
  'clip-title',
] as const;

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
});

export type PutLlmRouteDto = z.infer<typeof PutLlmRouteSchema>;

export const TASK_TYPES_TUPLE = TASK_TYPES;
