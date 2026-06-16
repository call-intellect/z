"use client";

import { useEntitlementContext } from "@/contexts/entitlement-context";
import type { FeatureKey, QuotaKey, TierKey } from "@/domain/entitlement";

export type UseEntitlementResult = {
  enabled: boolean;
  tier: TierKey;
  loading: boolean;
};

export function useEntitlement(feature: FeatureKey): UseEntitlementResult {
  const { entitlement, loading } = useEntitlementContext();
  if (!entitlement) {
    return {
      enabled: false,
      tier: "tier_basic",
      loading,
    };
  }
  return {
    enabled: entitlement.features[feature] === true,
    tier: entitlement.tier,
    loading,
  };
}

export type UseQuotaResult = {
  max: number;
  loading: boolean;
};

export function useQuota(quota: QuotaKey): UseQuotaResult {
  const { entitlement, loading } = useEntitlementContext();
  if (!entitlement) {
    return { max: 0, loading };
  }
  return { max: entitlement.quotas[quota] ?? 0, loading };
}
