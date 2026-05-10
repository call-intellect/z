'use client';

import { useAuth } from '@/contexts/auth-context';
import { TierGate } from '@/ui/components/TierGate';

import { DashboardClient } from './DashboardClient';
import { DirectorDashboardClient } from './DirectorDashboardClient';

/**
 * Client-компонент, выбирающий между manager-видом и директорским видом
 * на основе `useAuth()` → `currentOrgRole`/`isSuperAdmin`.
 *
 *   - owner / admin / super_admin → `<DirectorDashboardClient>` (Фаза 8),
 *     обёрнут в `<TierGate feature="feature.dashboard_director">` —
 *     директорский дашборд лежит в tier_pro+.
 *   - manager / роль не определена → существующий `<DashboardClient>`
 *     (manager-вид всегда доступен — это базовая, не-платная функция).
 *
 * Пока `useAuth().isLoading` — не рендерим, чтобы не было «прыжка» с
 * manager-вида на директорский после первого `accountsApi.me()`.
 */
export function DashboardRouter() {
  const { currentOrgRole, isSuperAdmin, isLoading } = useAuth();

  if (isLoading) {
    return null;
  }

  const isDirector =
    isSuperAdmin || currentOrgRole === 'owner' || currentOrgRole === 'admin';

  if (isDirector) {
    return (
      <TierGate feature="feature.dashboard_director">
        <DirectorDashboardClient />
      </TierGate>
    );
  }
  return <DashboardClient />;
}
