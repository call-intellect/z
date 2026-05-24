'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { authApi } from '@/api/auth.api';
import { ApiError } from '@/api/api-error';
import { useAuth } from '@/contexts/auth-context';
import { toast } from 'sonner';
import { Skeleton } from '@/ui/components/shared/Skeleton';

import { MeetingPageShell } from './MeetingPageShell';

type Props = {
  meetingId: string;
  deepLinkToken: string | null;
};

type ExchangeStage = 'pending' | 'done';

/**
 * Client-обёртка: если есть `?t`, делаем exchange (cookie → backend ставит её)
 * и убираем токен из URL. После — рендерим обычный shell.
 *
 * Если exchange упал с 401 — это значит токен битый/просрочен; рендерим
 * `<MeetingPageShell />` — он покажет либо guest-flow, либо «нет доступа».
 */
export function ExchangeAndRender({ meetingId, deepLinkToken }: Props) {
  const router = useRouter();
  const { refresh } = useAuth();
  const [stage, setStage] = useState<ExchangeStage>(
    deepLinkToken ? 'pending' : 'done',
  );

  useEffect(() => {
    if (!deepLinkToken) return;

    let cancelled = false;
    (async () => {
      try {
        await authApi.exchange(deepLinkToken, meetingId);
        await refresh();
      } catch (e) {
        if (!(e instanceof ApiError) || e.code !== 'unauthorized') {
          // 4xx, отличные от 401 — покажем тостом, но всё равно идём дальше.
          const message = e instanceof Error ? e.message : 'Ошибка обмена токена.';
          toast.error(message);
        }
        // 401 — нормальное состояние «токен просрочен, рендерим как гостя».
      } finally {
        if (!cancelled) {
          // Убираем `?t=` из адреса; история заменяется (без stack-entry).
          router.replace(`/m/${meetingId}`);
          setStage('done');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkToken, meetingId]);

  if (stage === 'pending') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg-subtle p-6">
        <div className="w-full max-w-sm space-y-3">
          <Skeleton className="h-6 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </main>
    );
  }

  return <MeetingPageShell meetingId={meetingId} />;
}
