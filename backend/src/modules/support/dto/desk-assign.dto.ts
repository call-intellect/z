import { z } from 'zod';

/** DTO назначения тикета на сотрудника (reuse IssueAssignee M:M). */
export const DeskAssignSchema = z
  .object({
    userId: z.string().min(1).max(64),
  })
  .strict();

export type DeskAssignDto = z.infer<typeof DeskAssignSchema>;
