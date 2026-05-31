import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { AdminShell } from './AdminShell';

export const metadata: Metadata = {
  title: 'Z-Admin',
};

/**
 * Layout админских страниц `/admin/*` (без `/admin/login` — у того свой layout).
 *
 * Авторизация — клиентским `AdminAuthGuard` в `app/(admin)/layout.tsx`
 * (super_admin only; cookie + role check). Бэкенд проверяет RBAC дополнительно.
 *
 * Z-Admin = super_admin платформы Z. Org-admin (владелец тенанта) живёт в
 * (authenticated)/settings/admin/ — это разные роли и разные сайдбары. См.
 * plans/tz/2026-05-31-z-admin-standalone-route-group.md §3.3.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
