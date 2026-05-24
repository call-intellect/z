import { z } from 'zod';

/**
 * DTO модуля Push (Wave 2 backend-web-push, 2026-05-24).
 *
 * Sub-ТЗ упомянут в plans/sprints/2026-05-24-sprint-plan-wave-1.md
 * (Wave 2 frontend backend prerequisite).
 *
 * Frontend (см. frontend/src/lib/pwa/push.ts) шлёт payload:
 *   {
 *     endpoint: string,
 *     keys: { p256dh: string, auth: string },
 *     expirationTime: number | null,
 *     userAgent?: string
 *   }
 *
 * Мы принимаем такой же формат (для нативной совместимости с
 * `PushSubscription.toJSON()` Web Push API).
 */

// ─────────────────────────── Create ───────────────────────────

export const CreatePushSubscriptionBodySchema = z.object({
  endpoint: z.string().url('endpoint должен быть валидным URL'),
  keys: z.object({
    p256dh: z.string().min(1, 'keys.p256dh обязателен'),
    auth: z.string().min(1, 'keys.auth обязателен'),
  }),
  /**
   * Web Push spec: `expirationTime` — number (UNIX ms) или null. Большинство
   * push-сервисов отдают null. Принимаем оба варианта (опционально).
   */
  expirationTime: z.number().int().positive().nullable().optional(),
  userAgent: z.string().max(500).optional(),
});
export type CreatePushSubscriptionBody = z.infer<
  typeof CreatePushSubscriptionBodySchema
>;

// ─────────────────────────── Delete ───────────────────────────

export const DeletePushSubscriptionBodySchema = z.object({
  endpoint: z.string().url('endpoint должен быть валидным URL'),
});
export type DeletePushSubscriptionBody = z.infer<
  typeof DeletePushSubscriptionBodySchema
>;

// ─────────────────────────── Response ─────────────────────────

/**
 * Минимальный публичный view — без чувствительных ключей (p256dh, auth).
 * Их не отдаём наружу, даже владельцу — нет use-case'а, только риск утечки.
 */
export interface PushSubscriptionView {
  id: string;
  endpoint: string;
  userAgent: string | null;
  lastSeenAt: string;
  createdAt: string;
}

/** Полный response GET /me/push-subscriptions. */
export interface PushSubscriptionListResponse {
  items: PushSubscriptionView[];
}
