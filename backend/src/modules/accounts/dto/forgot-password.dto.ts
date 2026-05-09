import { z } from 'zod';

export const ForgotPasswordSchema = z.object({
  email: z.string().email('Невалидный email').max(254),
});

export type ForgotPasswordDto = z.infer<typeof ForgotPasswordSchema>;
