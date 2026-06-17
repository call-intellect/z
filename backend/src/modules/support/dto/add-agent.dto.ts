import { z } from 'zod';

export const AddAgentSchema = z
  .object({
    personId: z.string().min(1).max(64),
  })
  .strict();

export type AddAgentDto = z.infer<typeof AddAgentSchema>;
