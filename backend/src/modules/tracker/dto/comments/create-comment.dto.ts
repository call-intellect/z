import { z } from 'zod';

/**
 * Создание комментария к задаче. `parentCommentId` поддерживает треды.
 * `access='external'` — для гостевых пользователей (через guest-channel),
 * но пока в Phase 1 эндпоинт только под аутентификацией → access='internal'.
 */
export const CreateCommentSchema = z
  .object({
    content: z.string().min(1).max(50_000),
    contentHtml: z.string().max(80_000).nullable().optional(),
    contentStripped: z.string().max(50_000).nullable().optional(),
    parentCommentId: z.string().max(64).nullable().optional(),
    access: z.enum(['internal', 'external']).default('internal'),
    voiceUrl: z.string().url().max(2_048).nullable().optional(),
    voiceDuration: z.number().int().min(0).max(600).nullable().optional(),
    voiceTranscript: z.string().max(50_000).nullable().optional(),
  })
  .strict();

export type CreateCommentDto = z.infer<typeof CreateCommentSchema>;
