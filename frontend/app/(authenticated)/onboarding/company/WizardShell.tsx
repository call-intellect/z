'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

import { ApiError } from '@/api/api-error';
import { departmentsApi } from '@/api/structure.api';
import { useAuth } from '@/contexts/auth-context';
import { Button } from '@/ui/shadcn/button';
import { Progress } from '@/ui/shadcn/progress';
import { Skeleton } from '@/ui/shadcn/skeleton';

/**
 * Каркас wizard'а «Знакомство с компанией». Узкая колонка по центру,
 * сверху — progress-bar (1/5..5/5), снизу — кнопка «Прервать и вернуться
 * позже» (→ /dashboard).
 *
 * Гарды:
 *   1. Если `currentOrgRole !== 'owner'` — редирект на /dashboard.
 *   2. Если уже есть отделы (Department.count > 0) — wizard пройден, тоже
 *      редирект на /dashboard. Однократность wizard'а обеспечивается этим
 *      состоянием БД, без отдельной модели OnboardingState (см. ТЗ §6.1).
 *   3. Если API `/api/v1/departments` ещё не готов — на ошибке `network_error`
 *      или `http_404` мы остаёмся в wizard'е и просто рендерим contents —
 *      backend агент догонит позже. На `forbidden` тоже редирект на /dashboard.
 */
const TOTAL_STEPS = 5;

function stepFromPath(pathname: string | null): number {
  if (!pathname) return 1;
  const m = pathname.match(/\/onboarding\/company\/step-(\d+)/);
  if (!m) return 1;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 1 && n <= TOTAL_STEPS ? n : 1;
}

export function WizardShell({ children }: { children: ReactNode }) {
  const { user, currentOrgRole, currentOrgId, isLoading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  const [guardChecked, setGuardChecked] = useState(false);
  const [redirecting, setRedirecting] = useState(false);

  const step = stepFromPath(pathname);
  const progress = Math.round((step / TOTAL_STEPS) * 100);

  // Guard 1: owner-only.
  useEffect(() => {
    if (isLoading) return;
    if (!user) return;
    if (currentOrgRole !== 'owner') {
      setRedirecting(true);
      router.replace('/dashboard');
    }
  }, [isLoading, user, currentOrgRole, router]);

  // Guard 2: «wizard уже пройден» проверяется ТОЛЬКО на step-1.
  //
  // Логика: если owner заходит на step-1 и в Org уже есть отделы — значит,
  // знакомство было пройдено ранее, нужно увести его на /dashboard.
  //
  // На step-2..5 эту проверку НЕ делаем, иначе сразу после первого
  // POST /api/v1/departments внутри wizard'а нас бы выкинуло на дашборд
  // в момент перехода на step-2.
  useEffect(() => {
    if (isLoading) return;
    if (!user || currentOrgRole !== 'owner' || !currentOrgId) {
      setGuardChecked(true);
      return;
    }
    if (step !== 1) {
      setGuardChecked(true);
      return;
    }
    let cancelled = false;
    void departmentsApi
      .list(currentOrgId)
      .then((res) => {
        if (cancelled) return;
        if (res.items.length > 0) {
          setRedirecting(true);
          router.replace('/dashboard');
          return;
        }
        setGuardChecked(true);
      })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.code === 'forbidden') {
          setRedirecting(true);
          router.replace('/dashboard');
          return;
        }
        // Если API ещё не готов — пускаем в wizard, чтобы можно было
        // визуально пройти каркас (заявки уйдут на сервер позже).
        setGuardChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [isLoading, user, currentOrgRole, currentOrgId, step, router]);

  if (isLoading || !user || !guardChecked || redirecting) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-base">
        <div className="w-full max-w-md space-y-3 px-6">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-8 w-1/2" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-base">
      <header className="border-b border-border-subtle bg-bg-card">
        <div className="mx-auto flex max-w-3xl items-center gap-4 px-6 py-4">
          <div className="flex-1">
            <div className="mb-1 flex items-center justify-between text-xs text-fg-tertiary">
              <span>Знакомство с компанией</span>
              <span>
                Шаг {step} из {TOTAL_STEPS}
              </span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push('/dashboard')}
          >
            Прервать и вернуться позже
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-8">{children}</main>
    </div>
  );
}
