'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import { useAuth } from '@/contexts/auth-context';
import { Skeleton } from '@/ui/shadcn/skeleton';

/**
 * Guard раздела `/orchestrator/*` (и `/orchestrator/runs/[id]`). Логика:
 *   - доступ только у super_admin ИЛИ у владельца организации (owner);
 *   - остальным аутентифицированным ролям — redirect на /dashboard;
 *   - неаутентифицированных НЕ трогаем: родительский (authenticated)-layout
 *     уже разбирается с ними сам.
 *
 * Пока идёт загрузка / нет пользователя / роль не допущена — рендерим
 * скелет, чтобы контент orchestrator не мелькал недопущенному.
 *
 * Server-side проверка не нужна: middleware.ts в проекте отсутствует,
 * а API-вызовы из orchestrator защищены RBAC на бэке.
 */
export function OrchestratorAuthGuard({ children }: { children: ReactNode }) {
  const { user, isLoading, isSuperAdmin, currentOrgRole } = useAuth();
  const router = useRouter();

  const allowed = isSuperAdmin || currentOrgRole === 'owner';

  useEffect(() => {
    if (isLoading) return;
    // Неаутентифицированных не редиректим сами — этим занимается
    // родительский (authenticated)-layout.
    if (!user) return;
    if (!allowed) {
      router.replace('/dashboard');
    }
  }, [user, isLoading, allowed, router]);

  if (isLoading || !user || !allowed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-base">
        <div className="w-full max-w-sm space-y-3 px-6">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
