/**
 * Admin-redesign Фаза 8 — DTO для `LimitsAdminController`.
 *
 * UI `/admin/platform/limits` редактирует строки `AdminSetting` с
 * category='platform' и section='limits'. Сама запись и история — общая
 * с `AdminSettingsService`.
 */

import { z } from 'zod';

export const UpdateLimitSchema = z.object({
  /** Любое JSON-сериализуемое значение лимита (обычно number). */
  value: z.unknown(),
  /** Причина изменения (для high — обязательна минимум 10 символов). */
  reason: z.string().trim().min(1).max(1000).optional(),
});
export type UpdateLimitDto = z.infer<typeof UpdateLimitSchema>;
