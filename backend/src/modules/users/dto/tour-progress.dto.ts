/**
 * DTO для эндпоинтов `/api/v1/users/me/tour-progress` (Onboarding Tour).
 *
 * Источник: plans/tz/2026-05-27-tracker-onboarding-tour.md.
 *
 * Структура `tourProgress` в БД (User.tourProgress Json):
 *   {
 *     welcome?: { completedAt: string, skipped?: boolean },
 *     project?: { completedAt: string, skipped?: boolean },
 *     meeting?: { completedAt: string, skipped?: boolean },
 *   }
 *
 * `completedAt` отсутствует → тур начат, но не завершён.
 * `skipped: true` → пользователь нажал «Пропустить» (полу-завершён, не показываем заново).
 */

import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Идентификаторы туров, поддерживаемых системой. Закрытый список. */
export const TourIdSchema = z.enum(['welcome', 'project', 'meeting']);
export type TourId = z.infer<typeof TourIdSchema>;

/**
 * Прогресс одного тура — что писал клиент. `completedAt` обязателен (ISO);
 * `skipped` опционален и по умолчанию false. Если шаг ещё не пройден, клиент
 * шлёт `{ skipped: false }` без `completedAt` — но в БД он всё равно появится
 * со штампом запроса, иначе нечего merge'ить.
 */
const TourEntrySchema = z
  .object({
    completedAt: z.string().datetime().optional(),
    skipped: z.boolean().optional(),
  })
  .strict();

export const UpdateTourProgressSchema = z
  .object({
    tourId: TourIdSchema,
    completedAt: z.string().datetime().optional(),
    skipped: z.boolean().optional(),
  })
  .strict();

export type UpdateTourProgressBody = z.infer<typeof UpdateTourProgressSchema>;
export class UpdateTourProgressDto extends createZodDto(
  UpdateTourProgressSchema,
) {}

/** Ответ на GET — текущее состояние всех туров. */
export const TourProgressResponseSchema = z.object({
  welcome: TourEntrySchema.optional(),
  project: TourEntrySchema.optional(),
  meeting: TourEntrySchema.optional(),
});

export type TourProgressResponse = z.infer<typeof TourProgressResponseSchema>;
export class TourProgressResponseDto extends createZodDto(
  TourProgressResponseSchema,
) {}

/** Ответ на reset — пустой объект (туры обнулены). */
export const TourProgressResetResponseSchema = z.object({
  ok: z.literal(true),
});

export type TourProgressResetResponse = z.infer<
  typeof TourProgressResetResponseSchema
>;
export class TourProgressResetResponseDto extends createZodDto(
  TourProgressResetResponseSchema,
) {}
