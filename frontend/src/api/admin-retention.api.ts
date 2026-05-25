/**
 * API-клиент для `/admin/media/retention` — настройки сроков хранения.
 * Фаза 7 редизайна Z-Admin.
 *
 * Контракт backend (`AdminRetentionController` под префиксом
 * `/api/v1/admin/media/retention`):
 *   GET    /                        → RetentionPolicyApiDto[]
 *   PATCH  /:type   { days, reason } → RetentionPolicyApiDto
 *   GET    /:type/preview?days=Y    → RetentionPreviewApiDto
 *
 * Защита — `SuperAdminGuard` + `SuperAdminAuditInterceptor`
 * (severity='high' требует reason ≥ 10 символов на бэке).
 *
 * Если бэкенд ещё не реализован — клиент получит 404, UI покажет AdminEmpty.
 */

import { apiClient } from './api-client';
import type {
  RetentionPolicyApiDto,
  RetentionPreviewApiDto,
} from '@/domain/admin-retention';

const BASE = '/api/v1/admin/media/retention';

export const adminRetentionApi = {
  /** Список всех политик. */
  list: (): Promise<RetentionPolicyApiDto[]> =>
    apiClient.get<RetentionPolicyApiDto[]>(BASE),

  /**
   * Обновить срок хранения для конкретного типа. На бэке severity='high' →
   * `reason` обязателен (≥ 10 символов), иначе 400.
   */
  update: (
    type: string,
    days: number,
    reason: string,
  ): Promise<RetentionPolicyApiDto> =>
    apiClient.patch<RetentionPolicyApiDto>(
      `${BASE}/${encodeURIComponent(type)}`,
      { days, reason },
    ),

  /**
   * Предпросмотр: сколько объектов будут удалены, если сократить срок до
   * `days`. Возвращает `affectedCount` и сэмпл идентификаторов.
   */
  preview: (type: string, days: number): Promise<RetentionPreviewApiDto> =>
    apiClient.get<RetentionPreviewApiDto>(
      `${BASE}/${encodeURIComponent(type)}/preview?days=${encodeURIComponent(
        String(days),
      )}`,
    ),
};
