/**
 * API-клиент для `/admin/platform/crons` — BullMQ-неработающие @Cron-задачи.
 * Фаза 8 редизайна Z-Admin.
 *
 * Контракт backend (`CronManagerController` под префиксом
 * `/api/v1/admin/crons`):
 *   GET    /                            → CronScheduleApiDto[]
 *   GET    /with-history                → CronScheduleWithHistoryApiDto[]
 *   GET    /:name/history?limit=N       → { items: CronRunHistoryApiDto[] }
 *   PATCH  /:name   { expression?, enabled?, reason? } → { ok: true }
 *   POST   /:name/run                   → { ok: boolean, ... }
 *
 * Защита — `SuperAdminGuard` + `SuperAdminAuditInterceptor` (severity='high'
 * требует `reason` ≥ 10 символов на бэке).
 */

import { apiClient } from './api-client';
import type {
  CronRunHistoryApiDto,
  CronScheduleApiDto,
  CronScheduleWithHistoryApiDto,
} from '@/domain/admin-cron';

const BASE = '/api/v1/admin/crons';

export type UpdateCronRequest = {
  expression?: string;
  enabled?: boolean;
  reason?: string;
};

export const adminCronsApi = {
  list: (): Promise<CronScheduleApiDto[]> =>
    apiClient.get<CronScheduleApiDto[]>(BASE),

  listWithHistory: (): Promise<CronScheduleWithHistoryApiDto[]> =>
    apiClient.get<CronScheduleWithHistoryApiDto[]>(`${BASE}/with-history`),

  history: (
    name: string,
    limit = 20,
  ): Promise<{ items: CronRunHistoryApiDto[] }> =>
    apiClient.get<{ items: CronRunHistoryApiDto[] }>(
      `${BASE}/${encodeURIComponent(name)}/history?limit=${encodeURIComponent(String(limit))}`,
    ),

  update: (name: string, body: UpdateCronRequest): Promise<{ ok: true }> =>
    apiClient.patch<{ ok: true }>(
      `${BASE}/${encodeURIComponent(name)}`,
      body,
    ),

  runNow: (name: string): Promise<{ ok: boolean }> =>
    apiClient.post<{ ok: boolean }>(`${BASE}/${encodeURIComponent(name)}/run`, {}),
};
