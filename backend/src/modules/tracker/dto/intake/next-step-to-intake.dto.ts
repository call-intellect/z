import { z } from 'zod';

/**
 * Редизайн кабинета Ф5а (2026-06-13) — «следующий шаг отчёта → кандидат в задачу».
 *
 * Body для `POST /api/v1/meetings/:meetingId/next-steps/to-intake`. Создаёт
 * IntakeIssue (source='meeting') из текста next-step отчёта встречи. Сама
 * задача появится только после триажа (accept) — здесь только кандидат.
 *
 * A10 (2026-06-14) — замкнута петля провенанса: при промоуте кандидата в Issue
 * прокидываются `sourceBlockIds`, а их пересечение с `Decision.sourceBlockIds`
 * рождает `DecisionTaskLink(linkType='derived')`. Текущий FE id блоков-источников
 * не знает (next-step рендерится из structuredData отчёта), поэтому
 * `sourceBlockIds` опциональны: если фронт их не прислал — backend резолвит
 * провенанс по canonical-блокам встречи (best-effort).
 */
export const NextStepToIntakeSchema = z
  .object({
    /** Текст следующего шага (из next_steps отчёта). */
    text: z.string().trim().min(1).max(2000),
    /** Опц. развёрнутое описание. */
    description: z.string().trim().max(50_000).nullable().optional(),
    /**
     * A10 — опц. явные IdeaBlock-источники next-step (если FE их знает).
     * Если не переданы — backend резолвит по встрече (см. createFromMeetingNextStep).
     */
    sourceBlockIds: z
      .array(z.string().min(1).max(64))
      .max(64)
      .optional(),
  })
  .strict();

export type NextStepToIntakeDto = z.infer<typeof NextStepToIntakeSchema>;
