import { z } from 'zod';

export const DeskNoteSchema = z
  .object({
    message: z.string().min(1).max(10_000),
  })
  .strict();

export type DeskNoteDto = z.infer<typeof DeskNoteSchema>;
