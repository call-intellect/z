import { z } from 'zod';

export const CreateMeetingShareSchema = z.object({
  allowVideo: z.boolean().default(false),
  allowTranscript: z.boolean().default(false),
  allowTasks: z.boolean().default(true),
  allowChapters: z.boolean().default(true),
  allowChat: z.boolean().default(false),
  expirationDays: z.coerce.number().int().min(1).max(90),
});

export type CreateMeetingShareDto = z.infer<typeof CreateMeetingShareSchema>;

export const CreateHighlightShareSchema = z.object({
  expirationDays: z.coerce.number().int().min(1).max(90),
});

export type CreateHighlightShareDto = z.infer<typeof CreateHighlightShareSchema>;
