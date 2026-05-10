'use client';

/**
 * Хуки `useEntitlement` / `useQuota` (Фаза 12 knowledge-core).
 *
 * Тонкие обёртки над `EntitlementContext` — компоненты НЕ должны лезть в
 * контекст напрямую, чтобы не плодить boilerplate. Эти хуки гарантируют
 * единый способ получения признака «доступна ли фича X на текущем тарифе».
 *
 * Использование:
 *   ```tsx
 *   const {enabled, tier, loading} = useEntitlement('feature.theme');
 *   if (!enabled) return <UpgradeCta tier={tier} />;
 *   ```
 *
 * Семантика loading:
 *   - Пока `loading=true` — компоненту нужно показать nothing/skeleton, а не
 *     спешить рендерить «не доступно». Иначе возможен flicker «закрыто →
 *     открыто» при monter после login'а.
 *
 * Семантика «нет entitlement» (network error / нет Org):
 *   - `enabled=false`, `tier='tier_basic'`. fail-safe деградация. Лучше
 *     показать пользователю замок, чем случайно открыть платную фичу при
 *     ошибке сети.
 */

import { useEntitlementContext } from '@/contexts/entitlement-context';
import type { FeatureKey, QuotaKey, TierKey } from '@/domain/entitlement';

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
      tier: 'tier_basic',
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
