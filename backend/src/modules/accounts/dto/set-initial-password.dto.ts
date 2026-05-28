import { z } from 'zod';

import { STRONG_PASSWORD_RX } from './reset-password.dto';

export const SetInitialPasswordSchema = z.object({
  newPassword: z
    .string()
    .min(8, 'Минимум 8 символов')
    .max(200)
    .regex(STRONG_PASSWORD_RX, 'Пароль должен содержать букву и цифру'),
});

export type SetInitialPasswordDto = z.infer<typeof SetInitialPasswordSchema>;
