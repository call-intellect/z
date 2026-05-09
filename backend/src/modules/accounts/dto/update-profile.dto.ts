import { z } from 'zod';

export const UpdateProfileSchema = z.object({
  name: z.string().trim().min(1, 'Имя обязательно').max(120),
});

export type UpdateProfileDto = z.infer<typeof UpdateProfileSchema>;
