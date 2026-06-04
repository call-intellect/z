import { z } from 'zod';

/**
 * ТЗ «Команда + доступы» Фаза 2 — строка объединённого ростера команды:
 * все Person ⊕ участники (Membership) без связанной карточки. Источник
 * правды для раздела «Команда» → вкладка «Сотрудники».
 */
export const TeamRosterItemSchema = z.object({
  personId: z.string().nullable(),
  userId: z.string().nullable(),
  fullName: z.string(),
  email: z.string().nullable(),
  roleId: z.string().nullable(),
  roleName: z.string().nullable(),
  departmentId: z.string().nullable(),
  departmentName: z.string().nullable(),
  invitationStatus: z.enum(['none', 'pending', 'accepted', 'revoked', 'expired']),
  invitationId: z.string().nullable(),
  systemRole: z
    .enum(['owner', 'admin', 'manager', 'coo', 'hr_partner', 'demo_observer'])
    .nullable(),
  telegramLinked: z.boolean(),
  hasPersonCard: z.boolean(),
});
export type TeamRosterItem = z.infer<typeof TeamRosterItemSchema>;
