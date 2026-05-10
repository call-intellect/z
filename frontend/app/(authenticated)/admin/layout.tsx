import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { AdminShell } from './AdminShell';

export const metadata: Metadata = {
  title: 'Z-Admin',
};

/**
 * Layout группы `/admin/*` (Фаза 7).
 * Защита — клиентский guard в каждой странице (см. AdminPagePermissionGate).
 * Server-side проверки нет, потому что cookie-роуты разруливают на бэке.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
