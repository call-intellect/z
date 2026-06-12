'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { useAuth } from '@/contexts/auth-context';
import { TierGate } from '@/ui/components/TierGate';
import { IncompleteSetupBanner } from '@/ui/components/IncompleteSetupBanner';
import { MobileShell } from '@/ui/mobile/MobileShell';
import { MobileOverviewClient } from '@/ui/mobile/exec/MobileOverviewClient';

import { DirectorDashboardClient } from './DirectorDashboardClient';

/**
 * Client-компонент, выбирающий между manager-видом и директорским видом
 * на основе `useAuth()` → `currentOrgRole`/`isSuperAdmin`.
 *
 *   - owner / admin / super_admin → `<DirectorDashboardClient>` (Фаза 8).
 *   - manager (== member в Z) → редирект на `/me` (ТЗ 0c, sub-TZ 0c.4).
 *     Для member dashboard теперь не точка входа — он попадает на свой
 *     личный кабинет.
 *
 * Пока `useAuth().isLoading` — ничего не рендерим, чтобы избежать «прыжка».
 */
export function DashboardRouter() {
  const { currentOrgRole, isSuperAdmin, isLoading } = useAuth();
  const router = useRouter();

  const isDirector =
    isSuperAdmin || currentOrgRole === 'owner' || currentOrgRole === 'admin';

  useEffect(() => {
    if (isLoading) return;
    if (!isDirector) {
      router.replace('/me');
    }
  }, [isLoading, isDirector, router]);

  if (isLoading) {
    return null;
  }

  if (isDirector) {
    // Инвариант №1: десктоп НЕ меняем — десктоп-ветка MobileShell = дословно
    // `<DirectorDashboardClient />`. Ниже md рендерим мобильный «Обзор» на том
    // же роуте/тех же эндпоинтах. TierGate + IncompleteSetupBanner — общая
    // обёртка снаружи viewport-гейта.
    return (
      <TierGate feature="feature.dashboard_director">
        <IncompleteSetupBanner />
        <MobileShell
          mobile={<MobileOverviewClient />}
          desktop={<DirectorDashboardClient />}
        />
      </TierGate>
    );
  }
  // member — пока идёт редирект, ничего не показываем.
  return null;
}
