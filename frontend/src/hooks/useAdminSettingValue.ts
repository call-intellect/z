'use client';

import useSWR from 'swr';

import { apiClient } from '@/api/api-client';

type AdminSettingResponse<T> = {
  key: string;
  value: T;
  updatedAt?: string;
  updatedBy?: string | null;
};

/**
 * useAdminSettingValue — read-only хук для одного ключа `AdminSetting`.
 *
 * - SWR под капотом, ревалидация раз в 30 секунд.
 * - При ошибке возвращает `fallback` (если задан) или `undefined`.
 * - Запрос идёт на `GET /api/v1/admin/settings/:key`.
 *
 * Использование:
 *   const cosine = useAdminSettingValue<number>(
 *     'knowledge.theme.cosine_threshold',
 *     0.78,
 *   );
 */
export function useAdminSettingValue<T>(
  key: string,
  fallback?: T,
): T | undefined {
  const { data, error } = useSWR<AdminSettingResponse<T>>(
    key ? `admin-setting:${key}` : null,
    () =>
      apiClient.get<AdminSettingResponse<T>>(
        `/api/v1/admin/settings/${encodeURIComponent(key)}`,
      ),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      refreshInterval: 30_000,
      dedupingInterval: 5_000,
      keepPreviousData: true,
      shouldRetryOnError: false,
    },
  );

  if (error) return fallback;
  if (!data) return fallback;
  return data.value;
}
