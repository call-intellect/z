'use client';

import { useMemo } from 'react';
import useSWR from 'swr';

import { overviewApi } from '@/api/tracker/overview.api';
import {
  projectIntegrationsStatusFromApi,
  projectOverviewFromApi,
  type ProjectIntegrationsStatus,
  type ProjectOverviewSummary,
  type WorkloadSummary,
} from '@/domain/tracker';

/**
 * Tracker Project Overview (2026-05-27) — SWR-хук для агрегата «Обзор».
 *
 * Один запрос `/api/v1/projects/:projectId/overview` отдаёт все 7 виджетов
 * страницы. Кэшируется на стороне backend'а в Redis на 30 секунд.
 */
export function useProjectOverview(
  orgId: string | null | undefined,
  projectId: string | null | undefined,
): {
  overview: ProjectOverviewSummary | null;
  isLoading: boolean;
  error: unknown;
  mutate: () => Promise<unknown>;
} {
  const key =
    orgId && projectId ? ['tracker.project.overview', orgId, projectId] : null;
  const swr = useSWR(
    key,
    async () => {
      if (!orgId || !projectId) throw new Error('orgId/projectId required');
      return overviewApi.getOverview(orgId, projectId);
    },
    {
      revalidateOnFocus: false,
      // Совпадает с backend TTL — UI не дёргает чаще, чем кэш всё равно
      // отдаёт то же. На live-обновления — отдельный WS-канал (вне scope).
      refreshInterval: 30_000,
    },
  );

  const overview = useMemo<ProjectOverviewSummary | null>(
    () => (swr.data ? projectOverviewFromApi(swr.data) : null),
    [swr.data],
  );

  return {
    overview,
    isLoading: swr.isLoading,
    error: swr.error,
    mutate: () => swr.mutate(),
  };
}

/**
 * Tracker Project Overview (2026-05-27) — SWR-хук для вкладки «Загруженность».
 *
 * Возвращает таблицу «участник × состояние» (open/inProgress/overdue/completed7d).
 */
export function useProjectWorkload(
  orgId: string | null | undefined,
  projectId: string | null | undefined,
): {
  workload: WorkloadSummary | null;
  isLoading: boolean;
  error: unknown;
  mutate: () => Promise<unknown>;
} {
  const key =
    orgId && projectId ? ['tracker.project.workload', orgId, projectId] : null;
  const swr = useSWR(
    key,
    async () => {
      if (!orgId || !projectId) throw new Error('orgId/projectId required');
      return overviewApi.getWorkload(orgId, projectId);
    },
    { revalidateOnFocus: false },
  );

  return {
    workload: swr.data ?? null,
    isLoading: swr.isLoading,
    error: swr.error,
    mutate: () => swr.mutate(),
  };
}

/**
 * Tracker Project Overview (2026-05-27) — SWR-хук для вкладки «Приложения».
 */
export function useProjectIntegrationsStatus(
  orgId: string | null | undefined,
  projectId: string | null | undefined,
): {
  status: ProjectIntegrationsStatus | null;
  isLoading: boolean;
  error: unknown;
  mutate: () => Promise<unknown>;
} {
  const key =
    orgId && projectId
      ? ['tracker.project.integrations-status', orgId, projectId]
      : null;
  const swr = useSWR(
    key,
    async () => {
      if (!orgId || !projectId) throw new Error('orgId/projectId required');
      return overviewApi.getIntegrationsStatus(orgId, projectId);
    },
    { revalidateOnFocus: false },
  );

  const status = useMemo<ProjectIntegrationsStatus | null>(
    () => (swr.data ? projectIntegrationsStatusFromApi(swr.data) : null),
    [swr.data],
  );

  return {
    status,
    isLoading: swr.isLoading,
    error: swr.error,
    mutate: () => swr.mutate(),
  };
}
