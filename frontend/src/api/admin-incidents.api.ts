/**
 * API-клиент инцидентов (admin-redesign Фаза 1).
 *
 * Контракт: backend `AdminIncidentsController` под префиксом
 * `/api/v1/admin/incidents`. Защита — `SuperAdminGuard`.
 */

import { apiClient } from './api-client';
import { buildQuery } from './admin-helpers';
import type {
  IncidentFailedJobsListApi,
  IncidentQueuesListApi,
  AlertRuleApi,
} from '@/domain/admin-incidents';

export const adminIncidentsApi = {
  /** Очереди с raw-счётчиками. */
  listQueues: () =>
    apiClient.get<IncidentQueuesListApi>('/api/v1/admin/incidents/queues'),

  /** Последние failed-jobs по конкретной очереди. */
  listFailedJobs: (queueName: string, limit = 3) =>
    apiClient.get<IncidentFailedJobsListApi>(
      `/api/v1/admin/incidents/queues/${encodeURIComponent(queueName)}/failed${buildQuery({ limit })}`,
    ),

  /** Список правил алертов (MVP — заглушка). */
  listRules: () =>
    apiClient.get<{ items: AlertRuleApi[] }>(
      '/api/v1/admin/incidents/rules',
    ),
};
