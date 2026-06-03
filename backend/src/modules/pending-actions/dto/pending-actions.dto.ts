import { z } from 'zod';

/**
 * DTO модуля Pending Actions (Action Center B0, 2026-06-02).
 *
 * REST `/api/v1/pending-actions/*` — единый feed «что требует действия
 * пользователя» (бейдж/колокольчик/дашборд/Telegram). Контракт провайдеров
 * (PendingActionItem) определён в `services/pending-actions.service.ts`.
 */

// ─────────────────────────── Enums ─────────────────────────────────

export const PendingActionSourceSchema = z.enum([
  'curation',
  'conflict',
  'intake',
  'probe',
]);
export type PendingActionSourceDto = z.infer<typeof PendingActionSourceSchema>;

export const PendingActionSeveritySchema = z.enum(['normal', 'urgent']);
export type PendingActionSeverityDto = z.infer<
  typeof PendingActionSeveritySchema
>;

// ─────────────────────────── List query ────────────────────────────

export const ListPendingActionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListPendingActionsQuery = z.infer<
  typeof ListPendingActionsQuerySchema
>;

// ─────────────────────────── Snooze body ───────────────────────────

export const SnoozePendingActionBodySchema = z.object({
  source: PendingActionSourceSchema,
  resourceType: z.string().trim().min(1).max(80),
  resourceId: z.string().trim().min(1).max(80),
  /// На сколько часов отложить (1 час .. 30 суток).
  hours: z.coerce.number().int().min(1).max(720),
});
export type SnoozePendingActionBody = z.infer<
  typeof SnoozePendingActionBodySchema
>;
