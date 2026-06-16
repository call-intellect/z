import { z } from 'zod';

const KeyRegex = /^[a-z0-9._-]+$/i;

export const CreateFeatureFlagSchema = z.object({
  key: z
    .string()
    .trim()
    .min(2)
    .max(100)
    .regex(KeyRegex, 'Только латиница, цифры, точки и подчёркивания'),
  description: z.string().trim().min(1).max(500),
  defaultValue: z.boolean(),
  category: z.string().trim().min(1).max(64).default('experimental'),
});
export type CreateFeatureFlagDto = z.infer<typeof CreateFeatureFlagSchema>;

export const UpdateFeatureFlagSchema = z
  .object({
    description: z.string().trim().min(1).max(500).optional(),
    defaultValue: z.boolean().optional(),
    rolloutPercent: z.union([z.coerce.number().int().min(0).max(100), z.null()]).optional(),
    orgOverrides: z.record(z.string(), z.boolean()).optional(),
    category: z.string().trim().min(1).max(64).optional(),
  })
  .refine(
    (v) =>
      v.description !== undefined ||
      v.defaultValue !== undefined ||
      v.rolloutPercent !== undefined ||
      v.orgOverrides !== undefined ||
      v.category !== undefined,
    { message: 'Передайте хотя бы одно поле для обновления' },
  );
export type UpdateFeatureFlagDto = z.infer<typeof UpdateFeatureFlagSchema>;

export const SetOverrideSchema = z.object({
  value: z.boolean(),
});
export type SetOverrideDto = z.infer<typeof SetOverrideSchema>;

export const ResolveQuerySchema = z.object({
  tenantId: z.string().trim().min(1).max(200),
});
export type ResolveQueryDto = z.infer<typeof ResolveQuerySchema>;

export interface FeatureFlagItemDto {
  key: string;
  description: string;
  defaultValue: boolean;
  orgOverrides: Record<string, boolean>;
  rolloutPercent: number | null;
  category: string;
  updatedBy: string | null;
  updatedAt: string;
}

export interface ResolveResultDto {
  key: string;
  tenantId: string;
  value: boolean;
  source: 'override' | 'rollout' | 'default';
}
