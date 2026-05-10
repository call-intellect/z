import { z } from 'zod';

/**
 * Сменить роль участника. Удаление — отдельный DELETE-эндпоинт.
 */
export const UpdateMemberSchema = z.object({
  role: z.enum(['owner', 'admin', 'manager']),
});

export type UpdateMemberDto = z.infer<typeof UpdateMemberSchema>;
