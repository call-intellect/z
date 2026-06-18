import { z } from 'zod';

export const DeskReplySchema = z
  .object({
    message: z.string().min(1).max(10_000),
    fromDraftCommentId: z.string().max(64).optional(),
  })
  .strict();

export type DeskReplyDto = z.infer<typeof DeskReplySchema>;
