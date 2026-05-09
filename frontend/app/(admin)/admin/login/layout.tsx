import type { ReactNode } from 'react';

/**
 * Локальный layout для `/admin/login` — пере-определяет родительский
 * `(admin)/admin/layout.tsx` (тот оборачивает в `AdminRouteGuard`, который
 * редиректит неавторизованных). Здесь нам нужен «голый» wrapper —
 * иначе никто никогда не сможет залогиниться.
 */
export default function AdminLoginLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
