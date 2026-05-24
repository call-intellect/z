/**
 * Доменная модель webhook'а трекера (исходящие уведомления).
 *
 * Контракт: `backend/src/modules/tracker/services/webhooks.service.ts`.
 */

import type { WebhookEvent } from './enums';

// ─── ApiDto ─────────────────────────────────────────────────────────────────

export interface WebhookApi {
  id: string;
  tenantId: string;
  name: string;
  url: string;
  /** Полностью отдаётся только при create; PATCH/list — маска. */
  secretKey: string;
  events: string[];
  isActive: boolean;
  isInternal: boolean;
  version: number;
  createdByUserId: string;
  createdAt: string;
}

export interface WebhookLogApi {
  id: string;
  webhookId: string;
  eventType: string;
  requestMethod: string;
  requestUrl: string;
  responseStatus: number | null;
  responseTime: number | null;
  retryCount: number;
  success: boolean;
  errorMessage: string | null;
  createdAt: string;
}

export interface WebhookLogsResponseApi {
  items: WebhookLogApi[];
  total: number;
  page: number;
  limit: number;
}

export interface WebhookTestEnqueueResultApi {
  ok: boolean;
  jobId: string | null;
  logsUrl: string;
  message: string;
}

// ─── Domain ─────────────────────────────────────────────────────────────────

export interface Webhook {
  id: string;
  tenantId: string;
  name: string;
  url: string;
  secretKey: string;
  events: WebhookEvent[];
  isActive: boolean;
  isInternal: boolean;
  version: number;
  createdByUserId: string;
  createdAt: Date;
}

export interface WebhookLog {
  id: string;
  webhookId: string;
  eventType: string;
  requestMethod: string;
  requestUrl: string;
  responseStatus: number | null;
  responseTime: number | null;
  retryCount: number;
  success: boolean;
  errorMessage: string | null;
  createdAt: Date;
}

// ─── Mappers ────────────────────────────────────────────────────────────────

export function webhookFromApi(api: WebhookApi): Webhook {
  return {
    id: api.id,
    tenantId: api.tenantId,
    name: api.name,
    url: api.url,
    secretKey: api.secretKey,
    events: api.events as WebhookEvent[],
    isActive: api.isActive,
    isInternal: api.isInternal,
    version: api.version,
    createdByUserId: api.createdByUserId,
    createdAt: new Date(api.createdAt),
  };
}

export function webhookLogFromApi(api: WebhookLogApi): WebhookLog {
  return {
    id: api.id,
    webhookId: api.webhookId,
    eventType: api.eventType,
    requestMethod: api.requestMethod,
    requestUrl: api.requestUrl,
    responseStatus: api.responseStatus,
    responseTime: api.responseTime,
    retryCount: api.retryCount,
    success: api.success,
    errorMessage: api.errorMessage,
    createdAt: new Date(api.createdAt),
  };
}
