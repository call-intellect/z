'use client';

/**
 * `useSupportStatus` — флаги службы поддержки для UI (ТЗ 2026-06-09 support-desk).
 *
 *   - `deskEnabled` — деск настроен (флаг включён И вендор-Org задан); по нему
 *     гейтится показ плавающего виджета поддержки.
 *   - `isAgent` — текущий пользователь сотрудник поддержки; по нему гейтятся
 *     пункт сайдбара «Поддержка» и страницы `/support/desk/*`.
 *
 * Источник: GET /api/v1/support/me (CookieAuthGuard). Не зависит от текущей
 * Org, поэтому ключ статичный.
 */

import useSWR from 'swr';

import { supportApi } from '@/api/support.api';
import { toSupportStatus, type SupportStatus } from '@/domain/support';

export interface UseSupportStatusResult {
  status: SupportStatus | undefined;
  deskEnabled: boolean;
  isAgent: boolean;
  isLoading: boolean;
  error: unknown;
  mutate: () => void;
}

export function useSupportStatus(): UseSupportStatusResult {
  const { data, error, isLoading, mutate } = useSWR(
    'support-status',
    () => supportApi.getStatus().then(toSupportStatus),
    { revalidateOnFocus: false },
  );

  return {
    status: data,
    deskEnabled: data?.deskEnabled ?? false,
    isAgent: data?.isAgent ?? false,
    isLoading,
    error,
    mutate: () => {
      void mutate();
    },
  };
}
