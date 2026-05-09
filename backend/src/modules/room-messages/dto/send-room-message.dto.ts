import { z } from 'zod';

/**
 * Тело `POST /api/v1/meetings/:meetingId/room-messages`.
 *
 *   - `clientMessageId` — ulid (Crockford base32, 26 символов), сгенерированный фронтом.
 *     Используется для идемпотентности: повторный POST → возврат существующего.
 *   - `content` — текст сообщения, ограничение длины из `cfg.workspace.maxRoomMessageChars`
 *     (значение проверяем в сервисе, чтобы лимит конфигурировался ENV'ом без ребилда).
 *
 * Жёсткая верхняя граница в DTO стоит «с запасом» — от перебора больших payload'ов;
 * актуальный бизнес-лимит применяется в сервисе.
 */
export const SendRoomMessageSchema = z.object({
  clientMessageId: z
    .string()
    .trim()
    .min(8, 'clientMessageId слишком короткий')
    .max(64, 'clientMessageId слишком длинный'),
  content: z
    .string()
    .min(1, 'content не может быть пустым')
    .max(20_000, 'content слишком длинный (DTO-лимит)'),
});

export type SendRoomMessageDto = z.infer<typeof SendRoomMessageSchema>;
