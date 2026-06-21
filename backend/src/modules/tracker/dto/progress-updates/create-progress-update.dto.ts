import { z } from 'zod';

export const ProgressHealthSchema = z.enum(['on_track', 'at_risk', 'off_track']);
export type ProgressHealth = z.infer<typeof ProgressHealthSchema>;

export const CreateProgressUpdateSchema = z
  .object({
    health: ProgressHealthSchema,
    body: z.string().min(1).max(2000),
    doneText: z.string().max(2000).optional(),
    nextText: z.string().max(2000).optional(),
    periodStart: z.string().datetime().optional(),
    periodEnd: z.string().datetime().optional(),
  })
  .strict();
export type CreateProgressUpdateDto = z.infer<typeof CreateProgressUpdateSchema>;
