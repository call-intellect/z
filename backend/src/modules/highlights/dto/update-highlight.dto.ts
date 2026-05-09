import { z } from 'zod';

/**
 * `PATCH /api/v1/highlights/:id`. Только title/description — границы клипа
 * в MVP не редактируются (любая правка границ → render устаревает; в M3a
 * это ещё не покрыто, поэтому оставляем безопасное подмножество).
 */
export const UpdateHighlightSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(2000).nullish(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'нужно передать хотя бы одно поле',
  });

export type UpdateHighlightDto = z.infer<typeof UpdateHighlightSchema>;
