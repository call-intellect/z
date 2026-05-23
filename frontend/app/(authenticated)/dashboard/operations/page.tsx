import type { Metadata } from 'next';

import { OperationsDashboardClient } from './OperationsDashboardClient';

export const metadata: Metadata = {
  title: 'Операции — Z',
};

/**
 * SBA β-8 — `/dashboard/operations` — COO операционный дашборд.
 *
 * Server-обёртка; данные тянет client через `operationsDashboardApi`. Доступ
 * валидируется на backend через `RbacService.canViewOperationsDashboard`
 * (owner / admin / coo / super_admin). Manager → 403.
 */
export default function OperationsDashboardPage() {
  return <OperationsDashboardClient />;
}
