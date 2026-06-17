import { z } from 'zod';

export const SimilarIssueSchema = z.object({
  id: z.string(),
  identifier: z.string(),
  title: z.string(),
  stateId: z.string().nullable(),
  projectId: z.string(),
  completedAt: z.string().nullable(),
  similarity: z.number().min(0).max(1),
});

export type SimilarIssueDto = z.infer<typeof SimilarIssueSchema>;
