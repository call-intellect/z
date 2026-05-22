import { z } from 'zod';

/**
 * Параметры query для `GET /me/notifications`.
 */
export const ListMyNotificationsQuerySchema = z.object({
  status: z.enum(['unread', 'all', 'pending_response']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().min(1).optional(),
});
export type ListMyNotificationsQueryDto = z.infer<
  typeof ListMyNotificationsQuerySchema
>;

/**
 * `POST /me/notifications/:id/respond` — ответить на probe.
 *
 * Принимает свободный JSON: payload может содержать `text`, `choice`,
 * `value` — конкретный contract зависит от eventType, валидируется уже
 * в сервисе слоя 3 / 4, который выпустил probe. Для α-1 этого хватает.
 */
export const RespondNotificationSchema = z.object({
  payload: z.record(z.string(), z.unknown()),
});
export type RespondNotificationDto = z.infer<typeof RespondNotificationSchema>;

/**
 * `POST /me/notifications/free-note` — отправить свободную заметку из UI.
 * Сервис создаёт `RawEvent(source.type='conversational')` через
 * `ConversationalIngestAdapter`.
 */
export const CreateFreeNoteSchema = z.object({
  text: z.string().trim().min(1).max(20_000),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type CreateFreeNoteDto = z.infer<typeof CreateFreeNoteSchema>;
