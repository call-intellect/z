import { z } from 'zod';

export const LoginSchema = z.object({
  email: z.string().email('Невалидный email').max(254),
  password: z.string().min(1, 'Пароль обязателен').max(200),
});

export type LoginDto = z.infer<typeof LoginSchema>;
