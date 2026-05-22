/**
 * Фаза A.3 — DTO для `/admin/prompt-experiments` и `/orgs/:orgId/prompt-experiments`.
 *
 * Все схемы — `nestjs-zod` (используются `ZodValidationPipe`'ом контроллера).
 * Источник: ТЗ A §7.2 и §10.
 *
 * Валидаторы:
 *   - splitPercent: 0..100 (см. ТЗ §10.1, sticky-allocation по хэшу).
 *   - endsAt: ISO-дата, не раньше «сейчас + 1 час», не позже «сейчас + 30 дней» (§10.3).
 *   - notes: 0..2000 (для аудита).
 *
 * Лимит 3 одновременных эксперимента на Org проверяется в сервисе
 * (через `EntitlementService.getQuota('prompt_experiments_concurrent')`).
 */

import { z } from 'zod';

/** Статус эксперимента — соответствует строковому полю `PromptExperiment.status`. */
export const EXPERIMENT_STATUSES = ['draft', 'running', 'stopped', 'completed'] as const;
export type ExperimentStatus = (typeof EXPERIMENT_STATUSES)[number];

// ─── Список ────────────────────────────────────────────────────────────

export const ListPromptExperimentsQuerySchema = z.object({
  status: z.enum(EXPERIMENT_STATUSES).optional(),
  /** Фильтр по orgId. Для super_admin — null = только глобальные. Для org-scoped — игнорируется. */
  orgId: z.string().min(1).max(60).nullable().optional(),
});
export type ListPromptExperimentsQueryDto = z.infer<typeof ListPromptExperimentsQuerySchema>;

// ─── Создание ──────────────────────────────────────────────────────────

export const CreatePromptExperimentSchema = z.object({
  /** orgId — null = глобальный эксперимент (только super_admin). */
  orgId: z.string().min(1).max(60).nullable().optional(),
  templateAId: z.string().min(1).max(60),
  templateBId: z.string().min(1).max(60),
  splitPercent: z.number().int().min(0).max(100),
  /**
   * Дата автозавершения (cron перевод в `completed`).
   * Не раньше «сейчас + 1 час», не позже «сейчас + 30 дней».
   * ISO 8601 строка; null = эксперимент без авто-стопа (только ручной).
   */
  endsAt: z.string().datetime().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});
export type CreatePromptExperimentDto = z.infer<typeof CreatePromptExperimentSchema>;

// ─── Управление ────────────────────────────────────────────────────────

export const StopPromptExperimentSchema = z.object({
  /** Опциональный комментарий (записывается в notes). */
  reason: z.string().max(500).optional(),
});
export type StopPromptExperimentDto = z.infer<typeof StopPromptExperimentSchema>;

// ─── Аналитика ─────────────────────────────────────────────────────────

export const AnalyticsQuerySchema = z.object({
  /** Опциональный from-фильтр по AiResult.createdAt (ISO). */
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
export type AnalyticsQueryDto = z.infer<typeof AnalyticsQuerySchema>;
