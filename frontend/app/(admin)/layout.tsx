import type { ReactNode } from 'react';

import { AdminAuthGuard } from './AdminAuthGuard';

/**
 * Root-layout группы `(admin)`. <html>/<body>/AuthProvider/ThemeProvider живут
 * в `app/layout.tsx` (root). Здесь — только guard, без AppShell, без
 * EntitlementProvider / SubscriptionProvider / TourProvider / AssistantSidebar.
 *
 * Z-Admin (super_admin платформы) ≠ org-admin (settings/admin/*).
 * Org-admin живёт в (authenticated)/settings/admin/ и пользуется обычным
 * пользовательским AppShell.
 */
export default function AdminGroupLayout({ children }: { children: ReactNode }) {
  return <AdminAuthGuard>{children}</AdminAuthGuard>;
}
