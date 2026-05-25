/**
 * Admin-redesign Фаза 8 — DTO для `SecurityAdminController`.
 *
 * Все security-настройки имеют severity='high' — поэтому `reason` обязателен
 * (минимум 10 символов).
 */

import { z } from 'zod';

export const UpdateSecuritySettingSchema = z.object({
  value: z.unknown(),
  reason: z.string().trim().min(10).max(1000),
});
export type UpdateSecuritySettingDto = z.infer<
  typeof UpdateSecuritySettingSchema
>;
