/**
 * Доменная модель для `/admin/integrations/webhooks` — расширенное управление
 * Webhook-подписками (Фаза 6 редизайна Z-Admin).
 *
 * Этот клиент работает с НОВЫМ префиксом `/api/v1/admin/integrations/webhooks-mgmt`
 * (планируется), который добавляет к существующему `tracker.webhooks`:
 *  - историю доставок (deliveries) с cursor pagination;
 *  - DLQ — failed-only с кнопкой retry.
 *
 * Базовый CRUD «активных» webhook'ов реиспользуется из существующего
 * `webhooksApi`, см. `frontend/src/api/tracker/webhooks.api.ts`.
 */

// ────────────────────────── ApiDto ──────────────────────────

export type WebhookDeliveryStatusApi = 'success' | 'failed' | 'pending';

export type WebhookDeliveryApiDto = {
  id: string;
  webhookId: string;
  webhookUrl: string;
  eventType: string;
  status: WebhookDeliveryStatusApi;
  httpStatus: number | null;
  attempt: number;
  errorMessage: string | null;
  deliveredAt: string | null;
  createdAt: string;
};

export type WebhookDeliveriesPageApiDto = {
  items: WebhookDeliveryApiDto[];
  nextCursor: string | null;
};

// ────────────────────────── DomainModel ──────────────────────────

export type WebhookDeliveryDomain = {
  id: string;
  webhookId: string;
  webhookUrl: string;
  eventType: string;
  status: WebhookDeliveryStatusApi;
  /** Локализованная подпись статуса. */
  statusLabel: string;
  httpStatus: number | null;
  attempt: number;
  errorMessage: string | null;
  deliveredAt: Date | null;
  createdAt: Date;
};

export type WebhookDeliveriesPageDomain = {
  items: WebhookDeliveryDomain[];
  nextCursor: string | null;
  hasMore: boolean;
};

const DELIVERY_STATUS_LABELS: Record<WebhookDeliveryStatusApi, string> = {
  success: 'Доставлено',
  failed: 'Ошибка',
  pending: 'В очереди',
};

export function webhookDeliveryFromApi(
  api: WebhookDeliveryApiDto,
): WebhookDeliveryDomain {
  return {
    id: api.id,
    webhookId: api.webhookId,
    webhookUrl: api.webhookUrl,
    eventType: api.eventType,
    status: api.status,
    statusLabel: DELIVERY_STATUS_LABELS[api.status] ?? api.status,
    httpStatus: api.httpStatus,
    attempt: api.attempt,
    errorMessage: api.errorMessage,
    deliveredAt: api.deliveredAt ? new Date(api.deliveredAt) : null,
    createdAt: new Date(api.createdAt),
  };
}

export function webhookDeliveriesPageFromApi(
  api: WebhookDeliveriesPageApiDto,
): WebhookDeliveriesPageDomain {
  return {
    items: api.items.map(webhookDeliveryFromApi),
    nextCursor: api.nextCursor,
    hasMore: api.nextCursor !== null,
  };
}
