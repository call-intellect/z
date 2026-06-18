import { z } from 'zod';

import {
  ALL_FEATURES,
  ALL_QUOTAS,
  ALL_TIERS,
  type FeatureKey,
  type QuotaKey,
  type TierKey,
} from '../tier-config';

const FeatureKeySchema = z.enum(ALL_FEATURES as readonly [FeatureKey, ...FeatureKey[]]);
const QuotaKeySchema = z.enum(ALL_QUOTAS as readonly [QuotaKey, ...QuotaKey[]]);
const TierKeySchema = z.enum(ALL_TIERS as readonly [TierKey, ...TierKey[]]);

export const PatchEntitlementSchema = z
  .object({
    tier: TierKeySchema.optional(),
    featureOverrides: z.partialRecord(FeatureKeySchema, z.boolean()).optional(),
    quotaOverrides: z.partialRecord(QuotaKeySchema, z.coerce.number().int().min(0)).optional(),
    notes: z.string().max(2_000).nullable().optional(),
    reason: z.string().trim().min(1).max(500),
  })
  .refine(
    (v) =>
      v.tier !== undefined ||
      v.featureOverrides !== undefined ||
      v.quotaOverrides !== undefined ||
      v.notes !== undefined,
    {
      message:
        'тело должно содержать хотя бы одно из: tier, featureOverrides, quotaOverrides, notes',
    },
  );
export type PatchEntitlementDto = z.infer<typeof PatchEntitlementSchema>;

export interface EntitlementResponseDto {
  tenantId: string;
  tier: TierKey;
  rawTier: string;
  failedSafe: boolean;
  features: Record<FeatureKey, boolean>;
  quotas: Record<QuotaKey, number>;
  featureOverrides: Partial<Record<FeatureKey, boolean>>;
  quotaOverrides: Partial<Record<QuotaKey, number>>;
  notes?: string | null;
}
