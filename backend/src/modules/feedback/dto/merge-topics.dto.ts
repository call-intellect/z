import { z } from 'zod';

export const MergeTopicsSchema = z.object({
  targetId: z.string().min(1),
});
export type MergeTopicsBody = z.infer<typeof MergeTopicsSchema>;
