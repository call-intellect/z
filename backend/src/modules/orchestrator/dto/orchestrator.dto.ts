import { z } from 'zod';

export const PostOrchestratorRunBodySchema = z.object({
  task: z.string().trim().min(5).max(4000),
  depth: z.number().int().min(1).max(1).optional(),
});
export type PostOrchestratorRunBodyDto = z.infer<typeof PostOrchestratorRunBodySchema>;
