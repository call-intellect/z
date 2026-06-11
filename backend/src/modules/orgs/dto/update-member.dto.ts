import { z } from 'zod';

/**
 * Сменить роль участника. Удаление — отдельный DELETE-эндпоинт.
 *
 * A5 / Р3 (2026-06-10, решение владельца): добавлены роли `coo` (операционный
 * директор) и `hr_partner` (HR-партнёр) — они уже есть в enum `MembershipRole`
 * и в RBAC-политиках, но раньше были недоступны через API. Это разграничение
 * доступа (additive значения enum), выкатывается включённым.
 */
export const UpdateMemberSchema = z.object({
  role: z.enum(['owner', 'admin', 'manager', 'coo', 'hr_partner']),
});

export type UpdateMemberDto = z.infer<typeof UpdateMemberSchema>;
