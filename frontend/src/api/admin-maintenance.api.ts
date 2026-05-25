/**
 * API-клиент для `/admin/platform/maintenance` — бэкапы, реиндексация,
 * окна обслуживания. Фаза 8 редизайна Z-Admin.
 *
 * Контракт backend (`AdminMaintenanceController`, префикс
 * `/api/v1/admin/platform/maintenance`):
 *   GET   /              → MaintenanceStatusApiDto
 *   POST  /backup-now    → { ok: true, jobId: string } | 501 (Not Implemented)
 *   POST  /reindex-now   → { ok: true, jobId: string } | 501
 *
 * 501 — это сигнал «фича не подключена в этой инсталляции». UI на это
 * показывает disabled-кнопку с TODO-подсказкой.
 */

import { apiClient } from './api-client';
import type { MaintenanceStatusApiDto } from '@/domain/admin-maintenance';

const BASE = '/api/v1/admin/platform/maintenance';

export const adminMaintenanceApi = {
  status: (): Promise<MaintenanceStatusApiDto> =>
    apiClient.get<MaintenanceStatusApiDto>(BASE),

  backupNow: (reason: string): Promise<{ ok: true; jobId: string }> =>
    apiClient.post<{ ok: true; jobId: string }>(`${BASE}/backup-now`, {
      reason,
    }),

  reindexNow: (reason: string): Promise<{ ok: true; jobId: string }> =>
    apiClient.post<{ ok: true; jobId: string }>(`${BASE}/reindex-now`, {
      reason,
    }),
};
