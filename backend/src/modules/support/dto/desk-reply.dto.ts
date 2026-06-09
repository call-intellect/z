import { z } from 'zod';

/**
 * DTO ответа сотрудника поддержки клиенту (видимый клиенту, access='external').
 * `fromDraftCommentId` — Ф3-задел (правка черновика клона); в Ф1 принимается,
 * но логика DIFF/outcome не реализована (см. ТЗ §Ф3).
 */
export const DeskReplySchema = z
  .object({
    message: z.string().min(1).max(10_000),
    fromDraftCommentId: z.string().max(64).optional(),
  })
  .strict();

export type DeskReplyDto = z.infer<typeof DeskReplySchema>;
