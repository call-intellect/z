/**
 * API-клиент для `/admin/media/storage` — S3 buckets + статистика + переключение
 * провайдера. Фаза 7 редизайна Z-Admin.
 *
 * Контракт backend (`AdminStorageController` под префиксом
 * `/api/v1/admin/media/storage`):
 *   GET   /                  → StorageOverviewApiDto
 *   POST  /switch  { provider, reason } → { ok: true }
 *
 * Переключение провайдера также можно сделать через универсальный
 * `AdminSetting`-эндпоинт по ключу `storage.provider` (severity='destructive') —
 * это путь через `useAdminSettingEditor`. POST /switch — низкоуровневый,
 * используется только из UI как опция.
 *
 * При отсутствии backend-эндпоинтов клиент получит 404, UI покажет AdminEmpty.
 */

import { apiClient } from './api-client';
import type {
  StorageOverviewApiDto,
  StorageProviderApi,
} from '@/domain/admin-storage';

const BASE = '/api/v1/admin/media/storage';

export const adminStorageApi = {
  /** Сводка: текущий провайдер, бакеты, статистика. */
  overview: (): Promise<StorageOverviewApiDto> =>
    apiClient.get<StorageOverviewApiDto>(BASE),

  /**
   * Принудительное переключение провайдера. На бэке severity='destructive' →
   * `reason` обязателен (≥ 10 символов).
   */
  switchProvider: (
    provider: StorageProviderApi,
    reason: string,
  ): Promise<{ ok: true }> =>
    apiClient.post<{ ok: true }>(`${BASE}/switch`, { provider, reason }),
};
