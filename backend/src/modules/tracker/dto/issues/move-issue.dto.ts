import { z } from 'zod';

export const MoveIssueSchema = z
  .object({
    targetProjectId: z.string().min(1).max(64),
  })
  .strict();

export type MoveIssueDto = z.infer<typeof MoveIssueSchema>;
