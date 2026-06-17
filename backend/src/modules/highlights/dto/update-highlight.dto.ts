import { z } from 'zod';

export const UpdateHighlightSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(2000).nullish(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'нужно передать хотя бы одно поле',
  });

export type UpdateHighlightDto = z.infer<typeof UpdateHighlightSchema>;
