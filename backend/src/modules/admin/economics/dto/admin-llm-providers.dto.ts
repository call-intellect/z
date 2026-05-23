import { z } from 'zod';

/**
 * SBA α-10 wave 3 — DTO для /api/v1/admin/llm-providers.
 */
export const ProtocolKindSchema = z.enum([
  'openai-chat',
  'openai-responses',
  'anthropic-messages',
  'ollama-native',
  'custom-http',
]);
export type ProtocolKindDto = z.infer<typeof ProtocolKindSchema>;

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
});
export type CreateLlmProviderDto = z.infer<typeof CreateLlmProviderSchema>;

export const UpdateLlmProviderSchema = CreateLlmProviderSchema.partial().omit({
  name: true,
});
export type UpdateLlmProviderDto = z.infer<typeof UpdateLlmProviderSchema>;

export const ListLlmProvidersQuerySchema = z.object({
  includeInactive: z
    .union([z.boolean(), z.string()])
    .transform((v) => (typeof v === 'boolean' ? v : v === 'true' || v === '1'))
    .default(false),
});
export type ListLlmProvidersQuery = z.infer<typeof ListLlmProvidersQuerySchema>;
