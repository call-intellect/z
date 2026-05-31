import type { Metadata } from 'next';

import { ClonesAccessClient } from './ClonesAccessClient';

/**
 * Z-Admin: «Управление доступом к клонам».
 *
 * ТЗ 2026-05-26 `clones-marketplace-frontend` — волна 3B (админская часть).
 * Backend: `ClonesAdminController` (`OrgAdminGuard + TenantGuard`).
 */
export const metadata: Metadata = {
  title: 'Z-Admin — Доступы к клонам',
};

export default function AdminClonesPage() {
  return <ClonesAccessClient />;
}
