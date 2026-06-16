import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { CompanyAdminSidebar } from './CompanyAdminSidebar';

export const metadata: Metadata = {
  title: 'Админка компании',
};

/**
 * Двухколоночный layout «Админки компании» (ТЗ 2026-06-02).
 *
 * Структурно как `/settings/*`, но рендерит собственный
 * `CompanyAdminSidebar` (НЕ `SettingsSidebar`) — этим лечится баг
 * двойного сайдбара и разводятся две независимые поверхности.
 *
 * Доступ owner/admin Org: сайдбар скрыт для остальных ролей, а каждый
 * endpoint `/api/v1/org-admin/*` и `/api/v1/org/settings/*` защищён
 * `OrgAdminGuard` — при 403 клиент показывает empty-state.
 */
export default function CompanyAdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8">
      <CompanyAdminSidebar />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
