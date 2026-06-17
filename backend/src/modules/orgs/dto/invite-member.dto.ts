import { z } from 'zod';

export const InviteMemberSchema = z.object({
  email: z
    .string()
    .email('Невалидный адрес электронной почты')
    .max(254)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  name: z.string().trim().min(1, 'Имя обязательно').max(120).optional(),
  role: z.enum(['admin', 'manager', 'coo', 'hr_partner']).default('manager'),
  personId: z.string().min(1).optional(),
});

export type InviteMemberDto = z.infer<typeof InviteMemberSchema>;
