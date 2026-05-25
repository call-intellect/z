'use client';

/**
 * useLlmRoutes — SWR-хук для админ-страницы `/admin/llm-routes`.
 *
 * Контракт бэкенда: `GET /api/v1/admin/llm-routes`. Кэш-ключ глобальный
 * (`admin-llm-routes`) — после успешного PUT в `EditRouteDialog` вызываем
 * `mutate()` (либо локальный, либо `mutate('admin-llm-routes')`).
 */

import { useMemo } from 'react';
import useSWR from 'swr';

import { adminLlmRoutesApi } from '@/api/admin-llm-routes.api';
import {
  llmRoutesUiListFromApi,
  type LlmRouteUi,
} from '@/domain/admin-llm-route';

export const ADMIN_LLM_ROUTES_SWR_KEY = 'admin-llm-routes';

export interface UseLlmRoutesResult {
  routes: LlmRouteUi[];
  error: unknown;
  isLoading: boolean;
  mutate: () => Promise<unknown>;
}

export function useLlmRoutes(): UseLlmRoutesResult {
  const swr = useSWR(
    ADMIN_LLM_ROUTES_SWR_KEY,
    async () => adminLlmRoutesApi.list(),
    { revalidateOnFocus: false },
  );

  const routes = useMemo<LlmRouteUi[]>(
    () => (swr.data ? llmRoutesUiListFromApi(swr.data) : []),
    [swr.data],
  );

  return {
    routes,
    error: swr.error,
    isLoading: swr.isLoading,
    mutate: () => swr.mutate(),
  };
}
