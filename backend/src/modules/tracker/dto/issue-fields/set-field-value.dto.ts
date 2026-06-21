import { z } from 'zod';

export const SetFieldValueSchema = z
  .object({
    fieldId: z.string().min(1),
    value: z.unknown(),
  })
  .strict();
export type SetFieldValueDto = z.infer<typeof SetFieldValueSchema>;
