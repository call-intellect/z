import type { Metadata } from 'next';

import { SecurityClient } from './SecurityClient';

export const metadata: Metadata = {
  title: 'Безопасность',
};

/**
 * `/admin/platform/security` — Фаза 8 редизайна Z-Admin.
 *
 * Параметры Argon2id, TTL сессии и deep-link. Все значения — это обычные
 * `AdminSetting` с severity='high' (требуют reason ≥ 10 символов).
 *
 * Внизу — действие «Ротировать IP-salt» (необратимо).
 */
export default function AdminPlatformSecurityPage() {
  return <SecurityClient />;
}
