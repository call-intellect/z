import type { Metadata } from 'next';

import { FeatureFlagsClient } from './FeatureFlagsClient';

export const metadata: Metadata = {
  title: 'Feature flags — Z-Admin',
};

/**
 * `/admin/platform/flags` — Фаза 8 редизайна Z-Admin.
 *
 * Управление таблицей `FeatureFlag`: глобальный `defaultValue`, перечень
 * Org-overrides и (опционально) rolloutPercent.
 */
export default function AdminPlatformFlagsPage() {
  return <FeatureFlagsClient />;
}
