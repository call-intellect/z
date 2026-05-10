'use client';

import { useAuth } from '@/contexts/auth-context';

import { DashboardClient } from './DashboardClient';
import { DirectorDashboardClient } from './DirectorDashboardClient';

/**
 * Client-компонент, выбирающий между manager-видом и директорским видом
 * на основе `useAuth()` → `currentOrgRole`/`isSuperAdmin`.
 *
 *   - owner / admin / super_admin → `<DirectorDashboardClient>` (Фаза 8).
 *   - manager / роль не определена → существующий `<DashboardClient>`.
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
    return <DirectorDashboardClient />;
  }
  return <DashboardClient />;
}
