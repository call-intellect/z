/**
 * API-клиент для `/admin/integrations/webhooks` — расширенное управление
 * Webhook-подписками (Фаза 6 редизайна Z-Admin).
 *
 * Контракт backend: `AdminWebhooksMgmtController` под префиксом
 * `/api/v1/admin/integrations/webhooks-mgmt`. Защита — `SuperAdminGuard`.
 *
 * Активные webhook'и (CRUD по конкретной Org) реиспользуются из существующего
 * `webhooksApi` (`@/api/tracker/webhooks.api`). Здесь — глобальный
 * super-admin обзор: история доставок (с фильтром по статусу/url) и DLQ.
 */

import { apiClient } from './api-client';
import { buildQuery } from './admin-helpers';
import type { WebhookDeliveriesPageApiDto } from '@/domain/admin-webhook-mgmt';

const BASE = '/api/v1/admin/integrations/webhooks-mgmt';

export type DeliveriesListRequest = {
  status?: 'success' | 'failed' | 'pending';
  url?: string;
  cursor?: string;
  limit?: number;
};

export const adminWebhooksMgmtApi = {
  /**
   * Глобальный обзор активных webhook'ов (по всем Org).
   * Возвращает payload, идентичный по структуре `WebhookApi[]` (см. `tracker/webhooks.api`).
   * В UI отображается как агрегированная таблица.
   */
  listActive: <T>() => apiClient.get<T>(`${BASE}/active`),

  /** История доставок с cursor pagination. */
  listDeliveries: (
    req: DeliveriesListRequest = {},
  ): Promise<WebhookDeliveriesPageApiDto> =>
    apiClient.get<WebhookDeliveriesPageApiDto>(
      `${BASE}/deliveries${buildQuery(req)}`,
    ),

  /** DLQ — failed-only с возможностью retry. */
  listDlq: (
    req: { cursor?: string; limit?: number } = {},
  ): Promise<WebhookDeliveriesPageApiDto> =>
    apiClient.get<WebhookDeliveriesPageApiDto>(`${BASE}/dlq${buildQuery(req)}`),

  /** Повторно поставить в очередь failed-delivery. */
  retryDelivery: (deliveryId: string): Promise<{ ok: true }> =>
    apiClient.post<{ ok: true }>(
      `${BASE}/dlq/${encodeURIComponent(deliveryId)}/retry`,
      {},
    ),
};
