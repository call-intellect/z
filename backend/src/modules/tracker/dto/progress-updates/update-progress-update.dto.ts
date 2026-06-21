import { z } from 'zod';

import { ProgressHealthSchema } from './create-progress-update.dto';

export const UpdateProgressUpdateSchema = z
  .object({
    health: ProgressHealthSchema.optional(),
    body: z.string().min(1).max(2000).optional(),
    doneText: z.string().max(2000).nullable().optional(),
    nextText: z.string().max(2000).nullable().optional(),
  })
  .strict();
export type UpdateProgressUpdateDto = z.infer<typeof UpdateProgressUpdateSchema>;
