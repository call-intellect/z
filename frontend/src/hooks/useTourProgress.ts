'use client';

/**
 * SWR-хук для прогресса onboarding-туров пользователя.
 *
 * Используется TourProvider'ом — данные нужны единожды на старте, потом
 * только мутируются через PATCH. `revalidateOnFocus: false` — состояние
 * туров меняется только этим пользователем, гонок с другими сессиями нет
 * (если пользователь открыл два таба и где-то завершил тур — второй таб
 * подхватит при следующем mount, это ОК).
 *
 * Источник: plans/tz/2026-05-27-tracker-onboarding-tour.md.
 */

import useSWR from 'swr';

import {
  tourProgressApi,
  type TourProgressApi,
} from '@/api/users/tour-progress.api';

const SWR_KEY = ['users.me.tour-progress'];

export function useTourProgress(enabled: boolean = true): {
  progress: TourProgressApi | null;
  isLoading: boolean;
  error: unknown;
  mutate: (next?: TourProgressApi) => Promise<unknown>;
} {
  const swr = useSWR<TourProgressApi>(
    enabled ? SWR_KEY : null,
    () => tourProgressApi.get(),
    { revalidateOnFocus: false, revalidateOnReconnect: false },
  );

  return {
    progress: swr.data ?? null,
    isLoading: swr.isLoading,
    error: swr.error,
    mutate: (next?: TourProgressApi) =>
      next === undefined ? swr.mutate() : swr.mutate(next, { revalidate: false }),
  };
}
