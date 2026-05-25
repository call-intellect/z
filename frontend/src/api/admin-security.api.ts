/**
 * API-клиент для `/admin/platform/security` — настройки безопасности.
 * Фаза 8 редизайна Z-Admin.
 *
 * Большая часть полей хранится как обычные `AdminSetting` и редактируется
 * через `/api/v1/admin/settings/*`. Отдельный эндпоинт нужен только для
 * операций, которые не сводятся к save/patch — например, ротация
 * IP-salt (требует генерации нового секрета на бэке).
 *
 * Если бэкенд endpoint ещё не реализован — UI отлавливает 404/501 и
 * показывает соответствующий статус.
 */

import { apiClient } from './api-client';

const BASE = '/api/v1/admin/platform/security';

export const adminSecurityApi = {
  /**
   * Сгенерировать новый IP-salt. Существующий немедленно отзывается, все
   * сохранённые анонимизированные IP перестают совпадать с новыми. Операция
   * необратимая — реальные IP не восстановятся.
   */
  rotateIpSalt: (reason: string): Promise<{ ok: true; rotatedAt: string }> =>
    apiClient.post<{ ok: true; rotatedAt: string }>(
      `${BASE}/rotate-ip-salt`,
      { reason },
    ),
};
