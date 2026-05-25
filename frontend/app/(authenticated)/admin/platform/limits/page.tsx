import type { Metadata } from 'next';

import { LimitsClient } from './LimitsClient';

export const metadata: Metadata = {
  title: 'Глобальные лимиты — Z-Admin',
};

/**
 * `/admin/platform/limits` — Фаза 8 редизайна Z-Admin.
 *
 * Управление глобальными лимитами (MAX_*) через `AdminSetting`. Вкладки:
 *   - Глобальные: набор `limits.*` ключей, severity='high'.
 *   - По тарифу: список `Plan` с их `quotas` (через `adminPlansApi`).
 *   - Override по Org: указатель в `/admin/orgs/entitlements`.
 */
export default function AdminPlatformLimitsPage() {
  return <LimitsClient />;
}
