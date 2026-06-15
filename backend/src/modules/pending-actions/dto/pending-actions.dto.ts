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

// ─────────────────────────── Confirm body (Ф4 — сквозной резолв) ───

/**
 * Сквозной резолв item'а единой очереди решений (редизайн Ф4, 2026-06-13).
 * Один эндпоинт `POST /pending-actions/confirm` диспетчеризует по `source`:
 *
 *   - `curation`:  resolution `'approve'` (дефолт) | `'reject'` →
 *     CurationService.decide. Быстрое подтверждение для light-карточек (B4).
 *   - `conflict`:  resolution `'keep_old'|'accept_new'|'merge'` →
 *     ConflictService.resolve.
 *   - `intake`:    resolution `'accept'|'reject'` → IntakeService.triage.
 *                  Для accept можно передать `targetProjectId` (иначе берётся
 *                  suggested/привязанный проект; если проекта нет — ошибка).
 *   - `probe`:     resolution не нужен; обязателен `answerText` (свободный
 *                  ответ) → ConversationalService.respondToProbe.
 */
export const ConfirmResolutionSchema = z.enum([
  // curation
  'approve',
  // curation + intake
  'reject',
  // conflict
  'keep_old',
  'accept_new',
  'merge',
  // intake
  'accept',
]);
export type ConfirmResolutionDto = z.infer<typeof ConfirmResolutionSchema>;

export const ConfirmPendingActionBodySchema = z.object({
  source: PendingActionSourceSchema,
  resourceId: z.string().trim().min(1).max(80),
  /// Стратегия резолва (зависит от source). Для curation опционально (дефолт
  /// approve); для conflict/intake — обязательна; для probe игнорируется.
  resolution: ConfirmResolutionSchema.optional(),
  /// Свободный ответ на probe-вопрос (только source='probe').
  answerText: z.string().trim().min(1).max(10_000).optional(),
  /// Целевой проект для intake accept (опционально; иначе suggested/привязка).
  targetProjectId: z.string().trim().min(1).max(64).optional(),
});
export type ConfirmPendingActionBody = z.infer<
  typeof ConfirmPendingActionBodySchema
>;
