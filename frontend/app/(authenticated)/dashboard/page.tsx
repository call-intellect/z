import type { Metadata } from 'next';

import { DashboardRouter } from './DashboardRouter';

export const metadata: Metadata = {
  title: 'Главная',
};

/**
 * `/dashboard` — server-обёртка. Решение, какой вид показать
 * (manager vs director), принимает client-компонент `<DashboardRouter>`
 * на основе `useAuth()` → `currentOrgRole`/`isSuperAdmin`.
 *
 * Бэкенд защищает `/api/v1/dashboard/director` через
 * `RbacService.canViewDirectorDashboard` — manager не получит данные
 * директорского эндпоинта даже при попытке через DevTools.
 */
export default function DashboardPage() {
  return <DashboardRouter />;
}
