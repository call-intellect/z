/**
 * Admin-redesign Фаза 1 — DTO для `AdminIncidentsController`.
 *
 * Incidents = «что прямо сейчас сломано» (failed Bull-jobs, ошибочные cron'ы).
 * Alert-rules в MVP — in-memory stub без cron-проверки и без БД-таблицы.
 *
 * Жёсткие правила:
 *   - `confirmedNoMvp` обязателен для `POST /incidents/rules` (если false —
 *     сервис вернёт 503: «в MVP правила не активируются, требуется явное
 *     подтверждение клиентом»).
 *   - `id` rule'а генерируется на сервере (cuid-like, но без зависимости
 *     от prisma — просто crypto.randomUUID()).
 */

import { z } from 'zod';

export const CreateIncidentRuleSchema = z.object({
  name: z.string().trim().min(1).max(255),
  /** Тип события: 'queue_failed' | 'cron_failed' | 'manual'. */
  trigger: z.enum(['queue_failed', 'cron_failed', 'manual']),
  /** Условие в виде свободной строки (на MVP — для UI, без backend-парсинга). */
  condition: z.string().trim().min(1).max(1000),
  /** Куда слать алерт: 'log' | 'web_push' | 'email'. На MVP — только 'log'. */
  channel: z.enum(['log', 'web_push', 'email']).default('log'),
  enabled: z.boolean().default(true),
  /**
   * Обязательная заглушка: явное подтверждение клиента, что он знает —
   * в MVP правила НЕ активируются автоматически (нет cron-проверки).
   */
  confirmedNoMvp: z.boolean(),
});
export type CreateIncidentRuleDto = z.infer<typeof CreateIncidentRuleSchema>;
