import { z } from 'zod';

/** DTO внутренней заметки сотрудника (access='internal', не видна клиенту). */
export const DeskNoteSchema = z
  .object({
    message: z.string().min(1).max(10_000),
  })
  .strict();

export type DeskNoteDto = z.infer<typeof DeskNoteSchema>;
