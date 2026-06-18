import { z } from 'zod';

export const STRONG_PASSWORD_RX = /^(?=.*[A-Za-zА-Яа-я])(?=.*\d).{8,}$/;

export const ResetPasswordSchema = z.object({
  token: z.string().min(1, 'token обязателен').max(200),
  newPassword: z
    .string()
    .min(8, 'Минимум 8 символов')
    .max(200)
    .regex(STRONG_PASSWORD_RX, 'Пароль должен содержать букву и цифру'),
});

export type ResetPasswordDto = z.infer<typeof ResetPasswordSchema>;
