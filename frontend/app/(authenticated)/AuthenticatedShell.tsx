'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import { useAuth } from '@/contexts/auth-context';
import { EntitlementProvider } from '@/contexts/entitlement-context';
import { SubscriptionProvider } from '@/contexts/subscription-context';
import { AppShell } from '@/ui/components/app-shell/AppShell';
import { BreadcrumbProvider } from '@/ui/components/breadcrumbs/BreadcrumbContext';
import { AssistantSidebar } from '@/ui/components/dashboard/AssistantSidebar';
import { Skeleton } from '@/ui/shadcn/skeleton';
import { TourProvider, WelcomeTourAutoStart } from '@/ui/tour';

const ONBOARDING_PATH = '/onboarding/change-password';

/**
 * Клиентская обёртка над AppShell с двумя guard'ами:
 *   1. `auth.user === null` (после загрузки) → push на `/login?next=<path>`.
 *      Это страховка к middleware: если cookie вдруг истекла, пока юзер
 *      сидел на странице, на любом запросе придёт 401 → AuthProvider
 *      сбросит user → этот guard уведёт на /login.
 *   2. `auth.user.mustChangePassword` и пользователь НЕ на `/onboarding/...`
 *      → форсированно отправляем на `/onboarding/change-password`. До
 *      успешной смены остальные страницы недоступны.
 *
 * На самом `/onboarding/change-password` AppShell НЕ рендерим — там минимум
 * UI без sidebar (см. `app/(authenticated)/onboarding/layout.tsx`).
 */
export function AuthenticatedShell({ children }: { children: ReactNode }) {
  const { user, isLoading, mustChangePassword, profileCompletedAt, isSuperAdmin } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  const isOnboardingPath = pathname?.startsWith('/onboarding') ?? false;

  useEffect(() => {
    if (isLoading) return;

    if (!user) {
      const next = pathname && pathname !== '/' ? pathname : '/dashboard';
      router.replace(`/login?next=${encodeURIComponent(next)}`);
      return;
    }

    if (mustChangePassword && !isOnboardingPath) {
      router.replace(ONBOARDING_PATH);
      return;
    }

    // Блок A онбординга — если profileCompletedAt не выставлен → на экраны знакомства.
    // Супер-админ (владелец платформы) онбординг компании не проходит.
    if (!profileCompletedAt && !isOnboardingPath && !isSuperAdmin) {
      router.replace('/onboarding/welcome/step-1');
      return;
    }
  }, [user, isLoading, mustChangePassword, profileCompletedAt, isOnboardingPath, pathname, router, isSuperAdmin]);

  if (isLoading || !user) {
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

  // Onboarding-режим: AppShell не оборачивает (свой layout рисует контент).
  // EntitlementProvider тоже не нужен — на онбординге gating-фичи не светим.
  if (isOnboardingPath) {
    return <>{children}</>;
  }

  // mustChangePassword=true и редирект ещё не успел сработать — рендерим
  // skeleton, чтобы случайно не показать защищённые страницы.
  if (mustChangePassword) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-base">
        <Skeleton className="h-32 w-72" />
      </div>
    );
  }

  // profileCompletedAt=null и редирект ещё не успел сработать — рендерим skeleton.
  // Супер-админ онбординг не проходит — skeleton не нужен.
  if (!profileCompletedAt && !isSuperAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-base">
        <Skeleton className="h-32 w-72" />
      </div>
    );
  }

  // EntitlementProvider оборачивает все защищённые страницы — гейтинг
  // работает на /themes, /goals, /chat, /dashboard, /admin/*. См. Фаза 12.
  //
  // TourProvider оборачивает AppShell — onboarding-туры активны только для
  // авторизованных пользователей (не для onboarding/change-password,
  // не для гостей). Тур внутри сам проверяет прогресс через PATCH/GET.
  return (
    <EntitlementProvider>
      <SubscriptionProvider>
        <TourProvider>
          <BreadcrumbProvider>
            <AppShell>{children}</AppShell>
          </BreadcrumbProvider>
          <WelcomeTourAutoStart />
          <AssistantSidebar />
        </TourProvider>
      </SubscriptionProvider>
    </EntitlementProvider>
  );
}
