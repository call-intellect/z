import { z } from 'zod';

/**
 * DTO для запуска импорта из внешних трекеров (Битрикс24 / Trello / Я.Трекер).
 * Wave 3 / Tracker Phase 5 (2026-05-24).
 *
 * Общая модель параметров:
 *   - `userMappings`: Record<email, ourUserId | null>.
 *     - значение = string → email замаплен на нашего user'а (assignee создаётся).
 *     - значение = null → намеренно skip (assignee НЕ создаётся).
 *     - email отсутствует в Record → unmatched (попадёт в ImportLog.unmatchedJson).
 *
 * Идемпотентность импорта — через Issue.externalSource + Issue.externalId
 * (см. TrelloImportStrategy).
 */

/** Email → ourUserId mapping. null = skip. Отсутствие ключа = unmatched. */
export const UserMappingsSchema = z.record(
  z.string().email().max(254),
  z.string().min(1).max(64).nullable(),
);
export type UserMappingsDto = z.infer<typeof UserMappingsSchema>;

/**
 * Запуск импорта из Trello.
 *
 * - `jsonContent` — целиком JSON-export Trello (от пользователя через wizard).
 *   Произвольная структура, валидируется внутри стратегии.
 * - `selectedBoardIds` — какие board'ы из JSON импортировать.
 * - `userMappings` — см. выше.
 */
export const StartTrelloImportSchema = z
  .object({
    // jsonContent — большой произвольный объект; ограничим только тип.
    jsonContent: z.record(z.string(), z.unknown()),
    selectedBoardIds: z.array(z.string().min(1).max(64)).min(1).max(100),
    userMappings: UserMappingsSchema.default({}),
  })
  .strict();
export type StartTrelloImportDto = z.infer<typeof StartTrelloImportSchema>;

/**
 * Запуск импорта из Битрикс24. Phase 5 part 1: worker — заглушка
 * (NotImplementedException). DTO готов на будущее.
 */
export const StartBitrix24ImportSchema = z
  .object({
    webhookUrl: z.string().url().max(2_048),
    selectedGroupIds: z.array(z.string().min(1).max(64)).min(1).max(100),
    userMappings: UserMappingsSchema.default({}),
  })
  .strict();
export type StartBitrix24ImportDto = z.infer<typeof StartBitrix24ImportSchema>;

/**
 * Запуск импорта из Яндекс.Трекера. Phase 5 part 1: worker — заглушка.
 */
export const StartYandexTrackerImportSchema = z
  .object({
    oauthToken: z.string().min(1).max(512),
    selectedQueueIds: z.array(z.string().min(1).max(64)).min(1).max(100),
    userMappings: UserMappingsSchema.default({}),
  })
  .strict();
export type StartYandexTrackerImportDto = z.infer<
  typeof StartYandexTrackerImportSchema
>;

/** Query для GET /api/v1/tracker/imports. */
export const ListImportsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().max(64).optional(),
    source: z.enum(['trello', 'bitrix24', 'yandex_tracker']).optional(),
    status: z.enum(['running', 'completed', 'failed', 'cancelled']).optional(),
  })
  .strict();
export type ListImportsQuery = z.infer<typeof ListImportsQuerySchema>;
