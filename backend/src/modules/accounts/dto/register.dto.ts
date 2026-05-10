import { z } from 'zod';

/**
 * Lead-style регистрация: только email + name. Пароль генерируется
 * сервером и приходит письмом.
 *
 * `honeypot` — скрытое поле для отсева ботов. На фронте оно `display:none`,
 * пользователь его не заполняет; бот заполняет всё подряд → блок.
 */
export const RegisterSchema = z.object({
  email: z.string().email('Невалидный email').max(254),
  name: z.string().trim().min(1, 'Имя обязательно').max(120),
  /** Опциональное название компании. Если пусто — бэк подставит "Компания {name}". */
  companyName: z.string().trim().min(1).max(120).optional(),
  honeypot: z.string().optional(),
});

export type RegisterDto = z.infer<typeof RegisterSchema>;
