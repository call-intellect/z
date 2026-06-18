import { z } from 'zod';

export const CreateHighlightSchema = z
  .object({
    startMs: z.coerce.number().int().min(0),
    endMs: z.coerce.number().int().min(1),
    title: z.string().trim().min(1).max(200),
    description: z.string().max(2000).nullish(),
  })
  .refine((v) => v.endMs > v.startMs, {
    message: 'endMs должен быть больше startMs',
    path: ['endMs'],
  });

export type CreateHighlightDto = z.infer<typeof CreateHighlightSchema>;
