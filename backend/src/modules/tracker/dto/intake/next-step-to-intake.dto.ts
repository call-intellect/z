import { z } from 'zod';

/**
 * Редизайн кабинета Ф5а (2026-06-13) — «следующий шаг отчёта → кандидат в задачу».
 *
 * Body для `POST /api/v1/meetings/:meetingId/next-steps/to-intake`. Создаёт
 * IntakeIssue (source='meeting') из текста next-step отчёта встречи. Сама
 * задача появится только после триажа (accept) — здесь только кандидат.
 *
 * Полную петлю sourceBlockIds + DecisionTaskLink здесь НЕ делаем — это Ф8.1.
 */
export const NextStepToIntakeSchema = z
  .object({
    /** Текст следующего шага (из next_steps отчёта). */
    text: z.string().trim().min(1).max(2000),
    /** Опц. развёрнутое описание. */
    description: z.string().trim().max(50_000).nullable().optional(),
  })
  .strict();

export type NextStepToIntakeDto = z.infer<typeof NextStepToIntakeSchema>;
