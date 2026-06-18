import { z } from 'zod';

export const NextStepToIntakeSchema = z
  .object({
    text: z.string().trim().min(1).max(2000),
    description: z.string().trim().max(50_000).nullable().optional(),
    sourceBlockIds: z.array(z.string().min(1).max(64)).max(64).optional(),
  })
  .strict();

export type NextStepToIntakeDto = z.infer<typeof NextStepToIntakeSchema>;
