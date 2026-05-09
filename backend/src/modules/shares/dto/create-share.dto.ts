import { z } from 'zod';

/**
 * `POST /api/v1/meetings/:id/shares`. `expirationDays` валидируется по
 * `cfg.share.allowedExpirationDays` (1, 7, 14) — на уровне сервиса.
 */
export const CreateMeetingShareSchema = z.object({
  allowVideo: z.boolean().default(false),
  allowTranscript: z.boolean().default(false),
  allowTasks: z.boolean().default(true),
  allowChapters: z.boolean().default(true),
  allowChat: z.boolean().default(false),
  expirationDays: z.coerce.number().int().min(1).max(90),
});

export type CreateMeetingShareDto = z.infer<typeof CreateMeetingShareSchema>;

/**
 * `POST /api/v1/highlights/:id/shares`. Только expirationDays.
 */
export const CreateHighlightShareSchema = z.object({
  expirationDays: z.coerce.number().int().min(1).max(90),
});

export type CreateHighlightShareDto = z.infer<typeof CreateHighlightShareSchema>;
