/**
 * Admin-redesign Фаза 6 — DTO для `AdminWebhooksMgmtController`.
 *
 * Управление webhook-подписками и доставками из админки. Слой `webhooks-mgmt`
 * не пересекается с гипотетическим существующим `/admin/webhooks` — у нас
 * выделенный префикс `/admin/integrations/webhooks-mgmt`.
 */

import { z } from 'zod';

// ──────────────────────────── queries ────────────────────────────────────

export const DeliveriesQuerySchema = z.object({
  /** Opaque cursor (createdAt+id, base64). */
  cursor: z.string().trim().min(1).max(512).optional(),
  /** Размер страницы. По умолчанию 50, максимум 200. */
  limit: z.coerce.number().int().min(1).max(200).default(50),
  /** Опц. фильтр по статусу доставки (`WebhookDelivery.status`). */
  status: z
    .enum(['pending', 'retrying', 'delivered', 'failed'])
    .optional(),
  /** Опц. подстрока в URL подписки (для поиска). */
  url: z.string().trim().min(1).max(255).optional(),
});
export type DeliveriesQueryDto = z.infer<typeof DeliveriesQuerySchema>;

// ──────────────────────────── responses ──────────────────────────────────

export interface ActiveWebhookRowDto {
  id: string;
  tenantId: string | null;
  url: string;
  events: ReadonlyArray<string>;
  status: string;
  lastDeliveryAt: string | null;
  createdAt: string;
}

export interface DeliveryRowDto {
  id: string;
  subscriptionId: string;
  url: string | null;
  event: string;
  status: string;
  attempts: number;
  lastStatus: number | null;
  lastResponse: string | null;
  nextAttemptAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

export interface DeliveriesPageDto {
  items: DeliveryRowDto[];
  nextCursor: string | null;
}

export interface RetryDeliveryResponseDto {
  ok: boolean;
  /** Был ли поставлен job в очередь. */
  enqueued: boolean;
  /** Сообщение для админа (что произошло, как проверить). */
  message: string;
}
