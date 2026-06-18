import { z } from 'zod';

function extractDigits(raw: string): string {
  return raw.replace(/\D/g, '');
}

export function normalizePhoneE164(raw: string): string | null {
  const digits = extractDigits(raw);
  if (digits.length < 10 || digits.length > 15) return null;

  if (digits.length === 11 && (digits.startsWith('8') || digits.startsWith('7'))) {
    return `+7${digits.slice(1)}`;
  }
  if (digits.length === 10 && digits.startsWith('9')) {
    return `+7${digits}`;
  }
  return `+${digits}`;
}

export const RegisterSchema = z.object({
  email: z.string().email('Невалидный email').max(254),
  name: z.string().trim().min(1, 'Имя обязательно').max(120),
  phone: z
    .string()
    .trim()
    .max(32, 'Телефон слишком длинный')
    .transform((v) => (v.length > 0 ? normalizePhoneE164(v) : null))
    .refine((v) => v === null || v.startsWith('+'), {
      message: 'Невалидный телефон: ожидается номер в формате +7XXXXXXXXXX',
    })
    .optional(),
  companyName: z.string().trim().min(1).max(120).optional(),
  honeypot: z.string().optional(),
  ref: z.string().trim().max(255).optional(),
  consentDataProcessing: z.boolean().refine((v) => v === true, {
    message: 'Согласие на обработку персональных данных обязательно',
  }),
  consentMarketing: z.boolean().default(false),
});

export type RegisterDto = z.infer<typeof RegisterSchema>;
