/**
 * Admin-redesign Фаза 0 — DTO для `AdminSettingsController`.
 *
 * Источник правды значений — модель `AdminSetting` (Prisma). UI Z-Admin
 * рендерит форму редактирования на основе `category`/`section`/`schemaId`,
 * историю смотрит через `GET /:key/history`.
 *
 * Жёсткие правила (плюс safe-seed-rules):
 *   - `value` — `unknown`, валидируется на уровне сервиса/seed'а (через
 *     schemaId-registry в будущих фазах).
 *   - `reason` обязателен в UI при `severity ∈ {high, destructive}`; здесь
 *     это просто string (минимум 10 символов уже валидируется сервисом для
 *     high/destructive — на Фазе 0 мы делаем optional, чтобы базовые
 *     low/medium-смены проходили без аргумента).
 *   - `expectedUpdatedAt` — для optimistic concurrency. Если поле задано,
 *     сервис сравнивает с текущим `updatedAt`; при несовпадении бросает
 *     `ConflictException`.
 */

import { z } from 'zod';

export const ListSettingsQuerySchema = z.object({
  category: z.string().trim().min(1).max(64).optional(),
  section: z.string().trim().min(1).max(64).optional(),
});
export type ListSettingsQueryDto = z.infer<typeof ListSettingsQuerySchema>;

export const SetSettingSchema = z.object({
  /**
   * Любое JSON-сериализуемое значение. На фазе 0 валидация per-key
   * выполняется приложением (схемой registry); zod здесь только
   * гарантирует наличие поля.
   */
  value: z.unknown(),
  reason: z.string().trim().min(1).max(1000).optional(),
  /** Optimistic concurrency: текущий `updatedAt`, который видел UI. */
  expectedUpdatedAt: z.coerce.date().optional(),
});
export type SetSettingDto = z.infer<typeof SetSettingSchema>;

export const HistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(50),
});
export type HistoryQueryDto = z.infer<typeof HistoryQuerySchema>;
