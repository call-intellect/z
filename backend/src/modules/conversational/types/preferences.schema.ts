import { z } from 'zod';

/**
 * Per-binding preferences. Хранится в `ChannelBinding.preferences` как
 * Json; на чтение валидируется этой схемой (с fallback'ами на дефолт).
 *
 *   - `quietHours` — окно «тихих часов» в формате `HH:mm-HH:mm` (серверная
 *     TZ; локализация в γ+). Не-критические уведомления в это окно
 *     откладываются до конца окна.
 *   - `eventTypeAllow` — белый список eventType'ов; если пуст/отсутствует,
 *     разрешены все.
 *   - `eventTypeDeny` — чёрный список eventType'ов. Приоритет ниже allow.
 *   - `rateLimitPerHour` — потолок не-критических уведомлений в час.
 *     Если null/отсутствует — используется
 *     `cfg.conversational.rateLimitDefaultPerHour`.
 *   - `disabledUntil` — пользовательский pause до конкретной даты.
 */
export const ChannelBindingPreferencesSchema = z
  .object({
    quietHours: z
      .string()
      .regex(/^\d{2}:\d{2}-\d{2}:\d{2}$/, 'формат "HH:mm-HH:mm"')
      .optional(),
    eventTypeAllow: z.array(z.string().min(1)).optional(),
    eventTypeDeny: z.array(z.string().min(1)).optional(),
    rateLimitPerHour: z.number().int().positive().optional(),
    disabledUntil: z.string().datetime().optional(),
  })
  .strict();

export type ChannelBindingPreferences = z.infer<
  typeof ChannelBindingPreferencesSchema
>;
