import { z } from 'zod';

export const UpdateMemberSchema = z.object({
  role: z.enum(['owner', 'admin', 'manager', 'coo', 'hr_partner']),
});

export type UpdateMemberDto = z.infer<typeof UpdateMemberSchema>;
