import { z } from 'zod';

export const UpdateChapterSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    summary: z.string().max(5000).nullish(),
    startMs: z.coerce.number().int().min(0).optional(),
    endMs: z.coerce.number().int().min(1).optional(),
    order: z.coerce.number().int().min(0).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'нужно передать хотя бы одно поле',
  })
  .refine((v) => v.startMs === undefined || v.endMs === undefined || v.endMs > v.startMs, {
    message: 'endMs должен быть больше startMs',
    path: ['endMs'],
  });

export type UpdateChapterDto = z.infer<typeof UpdateChapterSchema>;
