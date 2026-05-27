import { z } from 'zod';

/**
 * Lead-style регистрация: email + name + phone + согласия.
 * Пароль генерируется сервером и приходит письмом.
 *
 * `honeypot` — скрытое поле для отсева ботов. На фронте оно `display:none`.
 * `ref` — реферральная ссылка из URL параметра (tracking источника).
 * `consentDataProcessing` — обязательное согласие на обработку ПД.
 * `consentMarketing` — опциональное согласие на маркетинговые рассылки.
 */
export const RegisterSchema = z.object({
  email: z.string().email('Невалидный email').max(254),
  name: z.string().trim().min(1, 'Имя обязательно').max(120),
  /** Опциональный номер телефона. */
  phone: z.string().trim().max(20).optional(),
  /** Опциональное название компании. Если пусто — бэк подставит "Компания {name}". */
  companyName: z.string().trim().min(1).max(120).optional(),
  /** Скрытое поле для отсева ботов. */
  honeypot: z.string().optional(),
  /** Реферральная ссылка из URL параметра. */
  ref: z.string().trim().max(255).optional(),
  /** Обязательное согласие на обработку персональных данных. */
  consentDataProcessing: z.boolean().refine((v) => v === true, {
    message: 'Согласие на обработку персональных данных обязательно',
  }),
  /** Опциональное согласие на маркетинговые рассылки. */
  consentMarketing: z.boolean().default(false),
});

export type RegisterDto = z.infer<typeof RegisterSchema>;
