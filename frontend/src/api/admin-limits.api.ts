/**
 * API-клиент для `/admin/platform/limits` — глобальные лимиты.
 * Фаза 8 редизайна Z-Admin.
 *
 * По факту работа со значениями идёт через универсальный
 * `/api/v1/admin/settings/*` (см. `useAdminSettingEditor`). Этот файл
 * существует как точка-маркер: если в будущем появится отдельный endpoint
 * для дополнительных операций (массовый сброс, экспорт) — добавим сюда.
 */

import { apiClient } from './api-client';

const BASE = '/api/v1/admin/platform/limits';

export const adminLimitsApi = {
  /**
   * Опциональный list-эндпоинт. Если бэкенд не реализован, UI читает значения
   * напрямую через AdminSetting. Полезен для отображения override'ов «по
   * тарифу» на отдельной вкладке.
   */
  list: (): Promise<{ items: Array<{ key: string; value: unknown }> }> =>
    apiClient.get<{ items: Array<{ key: string; value: unknown }> }>(BASE),
};
