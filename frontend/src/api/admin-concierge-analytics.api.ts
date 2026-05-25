/**
 * API-клиент для Concierge / AI-чат analytics (Z-Admin, Фаза 2 редизайна).
 *
 * Контракт: backend `/api/v1/admin/analytics/concierge/*`. Защита — `SuperAdminGuard`.
 * Бэкенд готовится параллельно — при отсутствии эндпоинтов UI покажет
 * `AdminEmpty` («Будет подключено к chat-модулю»).
 */

import { apiClient } from './api-client';
import { buildQuery } from './admin-helpers';
import type {
  AdminConciergeNoAnswerApi,
  AdminConciergeOverviewApi,
  AdminConciergeTopQueriesApi,
} from '@/domain/admin-concierge-analytics';
import type { AdminPeriod } from '@/domain/admin-usage';

export type ConciergePeriodRequest = {
  period: AdminPeriod;
  from?: string;
  to?: string;
};

export const adminConciergeAnalyticsApi = {
  overview: (req: ConciergePeriodRequest) =>
    apiClient.get<AdminConciergeOverviewApi>(
      `/api/v1/admin/analytics/concierge/overview${buildQuery({ ...req })}`,
    ),

  topQueries: (req: ConciergePeriodRequest & { limit?: number }) =>
    apiClient.get<AdminConciergeTopQueriesApi>(
      `/api/v1/admin/analytics/concierge/top-queries${buildQuery({ ...req })}`,
    ),

  noAnswer: (
    req: ConciergePeriodRequest & { limit?: number; cursor?: string },
  ) =>
    apiClient.get<AdminConciergeNoAnswerApi>(
      `/api/v1/admin/analytics/concierge/no-answer${buildQuery({ ...req })}`,
    ),
};
