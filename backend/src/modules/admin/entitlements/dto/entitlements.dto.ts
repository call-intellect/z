import { z } from 'zod';

export const ListEntitlementsQuerySchema = z.object({
  hasOverrides: z
    .union([z.boolean(), z.string()])
    .transform((v) => (typeof v === 'boolean' ? v : v === 'true' || v === '1'))
    .default(true),
  plan: z.string().trim().min(1).max(64).optional(),
  cursor: z.string().trim().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListEntitlementsQueryDto = z.infer<typeof ListEntitlementsQuerySchema>;

const OverridesSchema = z.record(
  z.string(),
  z.union([z.boolean(), z.number(), z.string(), z.null()]),
);

export const UpdateEntitlementSchema = z
  .object({
    tier: z.string().trim().min(1).max(64).optional(),
    featureOverrides: OverridesSchema.nullable().optional(),
    quotaOverrides: OverridesSchema.nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'необходимо указать хотя бы одно поле',
  });
export type UpdateEntitlementDto = z.infer<typeof UpdateEntitlementSchema>;
