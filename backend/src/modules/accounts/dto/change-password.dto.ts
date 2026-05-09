import { z } from 'zod';

import { STRONG_PASSWORD_RX } from './reset-password.dto';

export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Текущий пароль обязателен').max(200),
  newPassword: z
    .string()
    .min(8, 'Минимум 8 символов')
    .max(200)
    .regex(STRONG_PASSWORD_RX, 'Пароль должен содержать букву и цифру'),
});

export type ChangePasswordDto = z.infer<typeof ChangePasswordSchema>;
