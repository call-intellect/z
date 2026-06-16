import { z } from 'zod';

export const UpdateCommentSchema = z
  .object({
    content: z.string().min(1).max(50_000),
    contentHtml: z.string().max(80_000).nullable().optional(),
    contentStripped: z.string().max(50_000).nullable().optional(),
  })
  .strict();

export type UpdateCommentDto = z.infer<typeof UpdateCommentSchema>;
