import { z } from 'zod';

/**
 * DTO ручного засева контура поддержки (Р-4, холодный старт).
 * Пары «вопрос → ответ» → IdeaBlock(canonical) + IdeaBlockAccess(via='closed').
 * Идемпотентность — по хэшу пары (на стороне сервиса). ТЗ 2026-06-09
 * support-desk Ф2 §REST-контракт.
 */
export const ContourSeedSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            question: z.string().min(1).max(2_000),
            answer: z.string().min(1).max(10_000),
          })
          .strict(),
      )
      .min(1)
      .max(200),
  })
  .strict();

export type ContourSeedDto = z.infer<typeof ContourSeedSchema>;
