import { z } from 'zod';

/**
 * DTO добавления галочки «сотрудник поддержки» (Р-7).
 * `personId` — Person вендор-Org, которого делаем членом контура-группы.
 * ТЗ 2026-06-09 support-desk Ф2 §REST-контракт.
 */
export const AddAgentSchema = z
  .object({
    personId: z.string().min(1).max(64),
  })
  .strict();

export type AddAgentDto = z.infer<typeof AddAgentSchema>;
