/**
 * DTO для POST /api/v1/feedback — отправка пользовательского сообщения
 * обратной связи. См. plans/tz/2026-05-25-user-feedback-with-ai-clustering.md
 * раздел «Пользовательские эндпоинты».
 */

import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Текст пользовательского сообщения. Валидация: trim перед проверкой
 * (см. feedback-user.controller), 1..5000 символов после трима, не пустой.
 * Сам Zod не делает trim — это ответственность сервиса/контроллера.
 */
export const SubmitFeedbackSchema = z.object({
  text: z.string().min(1).max(5000),
});

export type SubmitFeedbackBody = z.infer<typeof SubmitFeedbackSchema>;
export class SubmitFeedbackDto extends createZodDto(SubmitFeedbackSchema) {}
