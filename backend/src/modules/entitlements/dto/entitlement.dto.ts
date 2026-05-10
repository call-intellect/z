import { z } from 'zod';

import {
  ALL_FEATURES,
  ALL_QUOTAS,
  ALL_TIERS,
  type FeatureKey,
  type QuotaKey,
  type TierKey,
} from '../tier-config';

/**
 * DTO модуля Entitlements (Фаза 12 knowledge-core).
 *
 * Используется и backend'ом (ZodValidationPipe в контроллере), и frontend'ом
 * (через `bun run sync:dto`). При расширении тарифов / квот обновляется
 * автоматически вместе с `tier-config.ts`.
 */

const FeatureKeySchema = z.enum(
  ALL_FEATURES as readonly [FeatureKey, ...FeatureKey[]],
);
const QuotaKeySchema = z.enum(
  ALL_QUOTAS as readonly [QuotaKey, ...QuotaKey[]],
);
const TierKeySchema = z.enum(ALL_TIERS as readonly [TierKey, ...TierKey[]]);

/** Тело PATCH /api/v1/admin/orgs/:tenantId/entitlement (super_admin only). */
export const PatchEntitlementSchema = z
  .object({
    tier: TierKeySchema.optional(),
    featureOverrides: z.record(FeatureKeySchema, z.boolean()).optional(),
    quotaOverrides: z
      .record(QuotaKeySchema, z.coerce.number().int().min(0))
      .optional(),
    notes: z.string().max(2_000).nullable().optional(),
    /** Reason — обязательный, попадает в AuditLog для compliance. */
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

/** Полный resolved-entitlement для UI (`GET /me/entitlements`). */
export interface EntitlementResponseDto {
  tenantId: string;
  tier: TierKey;
  /** raw значение из БД — может отличаться от `tier` если сработал fail-safe. */
  rawTier: string;
  /** True — если в БД оказался незнакомый tier и сработал fail-safe. */
  failedSafe: boolean;
  features: Record<FeatureKey, boolean>;
  quotas: Record<QuotaKey, number>;
  featureOverrides: Partial<Record<FeatureKey, boolean>>;
  quotaOverrides: Partial<Record<QuotaKey, number>>;
  /** Видно только owner / super_admin (на /settings/billing и Z-Admin). */
  notes?: string | null;
}
