import { z } from 'zod';

export const TransitionIssueStateSchema = z
  .object({
    stateId: z.string().min(1).max(64),
    reason: z.string().max(2_000).nullable().optional(),
  })
  .strict();

export type TransitionIssueStateDto = z.infer<typeof TransitionIssueStateSchema>;
