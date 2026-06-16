import { z } from 'zod';

export const CreateChapterSchema = z
  .object({
    startMs: z.coerce.number().int().min(0),
    endMs: z.coerce.number().int().min(1),
    title: z.string().trim().min(1).max(200),
    summary: z.string().max(5000).nullish(),
    order: z.coerce.number().int().min(0).optional(),
  })
  .refine((v) => v.endMs > v.startMs, {
    message: 'endMs должен быть больше startMs',
    path: ['endMs'],
  });

export type CreateChapterDto = z.infer<typeof CreateChapterSchema>;
