import { z } from 'zod';

export const EmbeddingProtocolKindSchema = z.enum(['openai-embeddings', 'ollama-embeddings']);
export type EmbeddingProtocolKind = z.infer<typeof EmbeddingProtocolKindSchema>;

export const CreateEmbeddingModelSchema = z.object({
  modelKey: z.string().min(1).max(120),
  displayName: z.string().min(1).max(200),
  dimensions: z.number().int().min(64).max(4096),
  pricePerMillionInputTokensKopecks: z.number().int().min(0).optional(),
  isActive: z.boolean().default(true),
  notes: z.string().optional(),
});
export type CreateEmbeddingModelDto = z.infer<typeof CreateEmbeddingModelSchema>;

export const CreateEmbeddingProviderSchema = z.object({
  name: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .min(1)
    .max(60),
  displayName: z.string().min(1).max(120),
  baseUrl: z.string().url(),
  protocolKind: EmbeddingProtocolKindSchema,
  apiKey: z.string().optional(),
  defaultHeaders: z.record(z.string(), z.string()).optional(),
  isActive: z.boolean().default(true),
  priority: z.number().int().min(0).default(100),
  models: z.array(CreateEmbeddingModelSchema).optional(),
});
export type CreateEmbeddingProviderDto = z.infer<typeof CreateEmbeddingProviderSchema>;

export const UpdateEmbeddingProviderSchema = CreateEmbeddingProviderSchema.partial().omit({
  name: true,
  models: true,
});
export type UpdateEmbeddingProviderDto = z.infer<typeof UpdateEmbeddingProviderSchema>;

export const UpdateEmbeddingModelSchema = CreateEmbeddingModelSchema.partial().omit({
  modelKey: true,
});
export type UpdateEmbeddingModelDto = z.infer<typeof UpdateEmbeddingModelSchema>;

export const ListEmbeddingProvidersQuerySchema = z.object({
  includeInactive: z
    .union([z.boolean(), z.string()])
    .transform((v) => (typeof v === 'boolean' ? v : v === 'true' || v === '1'))
    .default(false),
});
export type ListEmbeddingProvidersQuery = z.infer<typeof ListEmbeddingProvidersQuerySchema>;
