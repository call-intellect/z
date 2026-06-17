import { z } from 'zod';

export const CreateLlmModelSchema = z.object({
  providerId: z.string().min(1),
  modelKey: z.string().min(1).max(120),
  displayName: z.string().min(1).max(200),
  contextWindow: z.number().int().positive().optional(),
  capabilities: z.record(z.string(), z.unknown()).optional(),
  category: z.enum(['flagship', 'fast', 'reasoning', 'embedding', 'experimental']).optional(),
  isActive: z.boolean().default(true),
  notes: z.string().max(2000).optional(),
});
export type CreateLlmModelDto = z.infer<typeof CreateLlmModelSchema>;

export const UpdateLlmModelSchema = CreateLlmModelSchema.partial().omit({
  providerId: true,
  modelKey: true,
});
export type UpdateLlmModelDto = z.infer<typeof UpdateLlmModelSchema>;

export const ListLlmModelsQuerySchema = z.object({
  providerId: z.string().optional(),
  category: z.enum(['flagship', 'fast', 'reasoning', 'embedding', 'experimental']).optional(),
  includeInactive: z
    .union([z.boolean(), z.string()])
    .transform((v) => (typeof v === 'boolean' ? v : v === 'true' || v === '1'))
    .default(false),
});
export type ListLlmModelsQuery = z.infer<typeof ListLlmModelsQuerySchema>;
