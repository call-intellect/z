import type { Metadata } from 'next';

import { ContributionsView } from './ContributionsView';

export const metadata: Metadata = {
  title: 'Мой вклад — Z',
};

/**
 * T1 (2026-05-23) — `/me/contributions`.
 *
 * Личный профиль вклада: идеи в работе, спасибо за неделю/всё время, стрик,
 * благодарности от AI, бейджи. Тоггл «скрыть благодарности от команды».
 *
 * RBAC: CookieAuthGuard + TenantGuard на backend. Если у Person нет линка
 * с User — frontend получит пустой snapshot (без ошибки).
 */
export default function MyContributionsPage() {
  return <ContributionsView title="Мой вклад" />;
}
