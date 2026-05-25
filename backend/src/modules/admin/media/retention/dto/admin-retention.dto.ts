/**
 * Admin-redesign Фаза 7 — DTO для `AdminRetentionController`.
 *
 * UI `/admin/media/retention` редактирует таблицу `RetentionPolicy` (глобальные
 * сроки хранения по типу — meeting_recording, share_view, api_access_log,
 * webhook_delivery, soft_delete_grace).
 *
 * Дополнительно — preview сколько объектов удалится при применении новых
 * `days`. Это даёт оператору ощутимое предупреждение перед high/destructive
 * операцией.
 *
 * Жёсткие правила:
 *   - `days` >= 1 (нельзя занулить хранение целиком).
 *   - `reason` обязателен (severity='high' для всех retention-настроек).
 *     Минимум 10 символов — соответствует UX-правилу AdminDangerZone.
 */

import { z } from 'zod';

// ───────────────────────────── update ────────────────────────────────────

export const UpdateRetentionSchema = z.object({
  /** Новое значение TTL (дни). 1..3650. */
  days: z.coerce.number().int().min(1).max(3650),
  /** Причина изменения. Обязательна, ≥10 символов (severity='high'). */
  reason: z.string().trim().min(10).max(1000),
});
export type UpdateRetentionDto = z.infer<typeof UpdateRetentionSchema>;

// ───────────────────────────── preview ───────────────────────────────────

export const PreviewRetentionQuerySchema = z.object({
  /** Новое значение TTL для расчёта affectedCount. По умолчанию = текущему. */
  days: z.coerce.number().int().min(1).max(3650).optional(),
});
export type PreviewRetentionQueryDto = z.infer<
  typeof PreviewRetentionQuerySchema
>;

// ───────────────────────────── responses ─────────────────────────────────

export interface RetentionPolicyItemDto {
  /** Стабильный идентификатор: meeting_recording / share_view / ... */
  type: string;
  /** Текущее значение TTL (дни). */
  days: number;
  /** Текстовое пояснение для UI. */
  description: string | null;
  /** Кто менял последним. */
  updatedBy: string | null;
  /** Для optimistic concurrency. */
  updatedAt: string;
}

export interface RetentionPreviewDto {
  type: string;
  currentDays: number;
  /** Запрошенный для расчёта (если не задан — равен currentDays). */
  proposedDays: number;
  /** Сколько записей попадает под удаление при таком TTL. */
  affectedCount: number;
  /** Пример ID последних 5 затронутых записей (для UI-подтверждения). */
  exampleIds: string[];
  /**
   * true, если для типа ретеншена нет поддерживаемой модели COUNT
   * (например, soft_delete_grace — мульти-модельный, точный расчёт не делается).
   */
  notCountable: boolean;
}
