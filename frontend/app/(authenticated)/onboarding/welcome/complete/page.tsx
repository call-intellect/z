'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { onboardingApi } from '@/api/onboarding.api';
import { useAuth } from '@/contexts/auth-context';

/**
 * Loading-экран авто-заливки демо-кабинета «ТехноСтрим» (ТЗ 2026-05-31
 * demo-auto-seed-and-cleanup §5.2).
 *
 * Сюда редиректит welcome step-6 после `completeWelcome` (бэк ставит job
 * `demo.seed`). Экран опрашивает `GET /demo-seed-status` каждые 700 мс и при
 * `completed` уводит в `/dashboard`. Таймаут 60 сек / `failed` — тоже уводит в
 * `/dashboard` (демо догрузится в фоне либо суперадмин зальёт вручную).
 */

const POLL_INTERVAL_MS = 700;
const TIMEOUT_MS = 60_000;

export default function WelcomeCompletePage() {
  const router = useRouter();
  const { currentOrgId, refresh } = useAuth();
  const [slow, setSlow] = useState(false);
  const doneRef = useRef(false);

  useEffect(() => {
    if (!currentOrgId) return;
    const orgId = currentOrgId;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();

    const finish = async (toastMsg?: { kind: 'error'; text: string }) => {
      if (doneRef.current) return;
      doneRef.current = true;
      if (pollTimer) clearTimeout(pollTimer);
      if (toastMsg) toast.error(toastMsg.text);
      // Обновляем auth/subscription-стейт, чтобы /dashboard сразу увидел демо.
      try {
        await refresh();
      } catch {
        /* refresh не критичен — дашборд сам подтянет */
      }
      router.replace('/dashboard');
    };

    const poll = async () => {
      if (doneRef.current) return;
      if (Date.now() - startedAt > TIMEOUT_MS) {
        void finish({
          kind: 'error',
          text: 'Демо-данные загрузятся в фоне — открываем кабинет',
        });
        return;
      }
      try {
        const { status } = await onboardingApi.getDemoSeedStatus(orgId);
        if (status === 'completed') {
          void finish();
          return;
        }
        if (status === 'failed') {
          void finish({
            kind: 'error',
            text: 'Не удалось загрузить демо-данные — открываем кабинет',
          });
          return;
        }
        // 'pending' | 'in_progress' — показываем «ещё чуть-чуть» после 8 сек.
        if (Date.now() - startedAt > 8_000) setSlow(true);
      } catch {
        // Сетевые ошибки polling'а не валят экран — продолжаем до таймаута.
      }
      pollTimer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
    };

    void poll();
    return () => {
      doneRef.current = true;
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [currentOrgId, refresh, router]);

  return (
    <div className="min-h-screen bg-bg-base flex flex-col">
      <header className="flex items-center justify-between px-6 py-4 border-b border-border-default">
        <span className="text-lg font-semibold text-fg-primary">Кора</span>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-6 py-8">
        <div className="w-full max-w-md text-center">
          <Loader2 className="mx-auto mb-6 h-10 w-10 animate-spin text-accent" />
          <h1 className="mb-3 text-2xl font-semibold text-fg-primary">
            Готовим ваш демо-кабинет
          </h1>
          <p className="text-sm text-fg-secondary">
            Заполняем кабинет данными компании «ТехноСтрим» — встречи, проекты,
            граф знаний и цифровые двойники. Это займёт несколько секунд.
          </p>
          {slow && (
            <p className="mt-4 text-xs text-fg-tertiary">
              Почти готово — ещё чуть-чуть…
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
