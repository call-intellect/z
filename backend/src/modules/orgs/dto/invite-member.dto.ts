import { z } from 'zod';

/**
 * Создание приглашения в Org.
 * email — может быть на ещё-не-зарегистрированного юзера: при принятии
 * инвайта будет создан/привязан соответствующий User.
 */
export const InviteMemberSchema = z.object({
  email: z.string().email('Невалидный email').max(254),
  role: z.enum(['admin', 'manager']).default('manager'),
});

export type InviteMemberDto = z.infer<typeof InviteMemberSchema>;
