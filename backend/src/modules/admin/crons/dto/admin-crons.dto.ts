/**
 * Admin-redesign Фаза 0 — DTO для `CronManagerController`.
 *
 * `expression` — стандартный cron-выражение в формате `node-cron` (5 или 6
 * полей). Здесь валидируем только базовый формат — Nest сам кинет понятную
 * ошибку при попытке создать CronJob с некорректным выражением.
 */

import { z } from 'zod';

const CronExpressionRegex = /^(\S+\s+){4,5}\S+$/;

export const UpdateCronScheduleSchema = z
  .object({
    expression: z
      .string()
      .trim()
      .min(3)
      .max(120)
      .regex(CronExpressionRegex, 'Cron-выражение должно содержать 5 или 6 полей')
      .optional(),
    enabled: z.boolean().optional(),
    reason: z.string().trim().min(1).max(1000).optional(),
  })
  .refine((v) => v.expression !== undefined || v.enabled !== undefined, {
    message: 'необходимо указать хотя бы одно поле (expression или enabled)',
  });
export type UpdateCronScheduleDto = z.infer<typeof UpdateCronScheduleSchema>;
