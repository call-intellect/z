import { z } from 'zod';

/**
 * Тело `POST /api/v1/meetings/:id/join`.
 *
 * `guest_name` — опционален в DTO, но обязателен В СЕРВИСЕ для guest-флоу.
 * Если пришёл хост по cookie — поле игнорируется.
 *
 * Ограничение длины 80 символов берём от UX («помещается в карточку участника»);
 * sanitize XSS-небезопасных символов делаем в сервисе, не в DTO,
 * чтобы schema не была удивительной (выкидывая `<` молча).
 */
export const JoinMeetingSchema = z.object({
  guest_name: z.string().min(1).max(80).optional(),
});

export type JoinMeetingDto = z.infer<typeof JoinMeetingSchema>;
