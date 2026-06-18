import { z } from 'zod';

export const CreateOrgSchema = z.object({
  name: z.string().trim().min(1, 'Название обязательно').max(120),
});

export type CreateOrgDto = z.infer<typeof CreateOrgSchema>;
