import { z } from 'zod';

export const ProtocolKindSchema = z.enum([
  'openai-chat',
  'openai-responses',
  'anthropic-messages',
  'ollama-native',
  'kie-native',
  'grsai-native',
  'custom-http',
]);

export const CreateLlmProviderSchema = z.object({
  name: z.string().min(1).max(60),
  displayName: z.string().min(1).max(120),
  baseUrl: z.string().url(),
  protocolKind: ProtocolKindSchema,
  capability: z.enum(['public', 'internal', 'sensitive', 'private']).default('public'),
  apiKey: z.string().optional(),
  defaultHeaders: z.record(z.string(), z.string()).optional(),
  globalRps: z.number().int().positive().optional(),
  isActive: z.boolean().default(true),
  useProxy: z.boolean().default(false),
  proxyPath: z.string().max(120).nullable().optional(),
  timeoutMs: z.number().int().positive().nullable().optional(),
  defaultModelKey: z.string().max(120).nullable().optional(),
  billingMode: z.enum(['per_token', 'subscription']).default('per_token'),
  subscriptionMonthlyCostUsd: z.number().nonnegative().nullable().optional(),
  subscriptionStartedAt: z.string().datetime().nullable().optional(),
});
export type CreateLlmProviderDto = z.infer<typeof CreateLlmProviderSchema>;

export const UpdateLlmProviderSchema = CreateLlmProviderSchema.partial()
  .omit({ name: true })
  .extend({ apiKey: z.string().nullable().optional() });
export type UpdateLlmProviderDto = z.infer<typeof UpdateLlmProviderSchema>;

export const DiscoverModelsPreviewSchema = z.object({
  baseUrl: z.string().url().max(500).optional(),
  protocolKind: ProtocolKindSchema,
  apiKey: z.string().max(500).optional(),
  defaultHeaders: z.record(z.string(), z.string()).optional(),
  timeoutMs: z.number().int().positive().max(120_000).optional(),
  useProxy: z.boolean().optional(),
  proxyPath: z.string().max(120).nullable().optional(),
});
export type DiscoverModelsPreviewDto = z.infer<typeof DiscoverModelsPreviewSchema>;

export const ListLlmProvidersQuerySchema = z.object({
  includeInactive: z
    .union([z.boolean(), z.string()])
    .transform((v) => (typeof v === 'boolean' ? v : v === 'true' || v === '1'))
    .default(false),
});
export type ListLlmProvidersQuery = z.infer<typeof ListLlmProvidersQuerySchema>;

export const SetDefaultProviderSchema = z.object({
  model: z.string().trim().min(1),
});
export type SetDefaultProviderDto = z.infer<typeof SetDefaultProviderSchema>;

export const RemoveProviderSchema = z.object({
  reassignDefaultTo: z
    .object({ providerId: z.string().min(1), model: z.string().trim().min(1) })
    .optional(),
});
export type RemoveProviderDto = z.infer<typeof RemoveProviderSchema>;
