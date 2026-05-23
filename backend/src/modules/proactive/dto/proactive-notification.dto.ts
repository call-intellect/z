import { z } from 'zod';

/**
 * SBA δ-2 — DTO для `/api/v1/me/proactive-notifications`.
 *
 * Используем плейн-zod (как в operations/daily-check-in.dto.ts), валидация —
 * через `ZodValidationPipe` в контроллере.
 */

export const ListProactiveQuerySchema = z.object({
  includeDismissed: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .optional()
    .transform((v) => v === true || v === 'true'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListProactiveQuery = z.infer<typeof ListProactiveQuerySchema>;

export const ProactiveNotificationDtoSchema = z.object({
  id: z.string(),
  ruleType: z.string(),
  severity: z.enum(['low', 'medium', 'high']),
  payload: z.unknown(),
  notificationId: z.string().nullable(),
  emittedAt: z.string(),
  dismissedAt: z.string().nullable(),
});
export type ProactiveNotificationDto = z.infer<
  typeof ProactiveNotificationDtoSchema
>;

export const ListProactiveResponseSchema = z.object({
  items: z.array(ProactiveNotificationDtoSchema),
});
export type ListProactiveResponseDto = z.infer<
  typeof ListProactiveResponseSchema
>;
