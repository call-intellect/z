import { z } from 'zod';

/**
 * Lead-style регистрация: email + name + phone + согласия.
 * Пароль генерируется сервером и приходит письмом.
 *
 * `honeypot` — скрытое поле для отсева ботов. На фронте оно `display:none`.
 * `ref` — реферральная ссылка из URL параметра (tracking источника).
 * `consentDataProcessing` — обязательное согласие на обработку ПД.
 * `consentMarketing` — опциональное согласие на маркетинговые рассылки.
 *
 * audit В8 (2026-05-29): телефон нормализуется в E.164 формат
 * (`+7XXXXXXXXXX` для российских номеров) до записи в БД. Это даёт:
 *   1. Детерминированный поиск/дедуп по телефону между сценариями
 *      (онбординг, биллинг-payer, Telegram, реф-привязка).
 *   2. Валидацию длины 11 цифр (РФ) — фильтрует ботов с мусором
 *      типа "1234567" или "+7 (XXX)" без цифр.
 *
 * Поддержанные входные форматы: `+7 (905) 123-45-67`, `8 905 123 4567`,
 * `89051234567`, `+79051234567`, `+7-905-123-45-67`. Всё → `+79051234567`.
 * Нероссийские номера (≥10 цифр, начинающиеся с не-7) принимаются
 * как `+<digits>` без доп. валидации country-code.
 */

/** Извлекает только цифры из произвольного телефонного ввода. */
function extractDigits(raw: string): string {
  return raw.replace(/\D/g, '');
}

/**
 * Нормализует телефон в E.164 (`+<digits>`). Для российских номеров
 * (11 цифр, начинаются с 7 или 8) приводит к `+7XXXXXXXXXX`. Для 10-значного
 * мобильного без кода страны (`9XXXXXXXXX`) — добавляет `+7`. Прочие
 * международные форматы оставляет как `+<digits>` если ≥10 цифр.
 *
 * Возвращает null если после очистки осталось <10 цифр — это явно мусор
 * либо ввод вида "8 800" (без основной части). Zod .refine(...) превратит
 * null в ошибку валидации.
 */
export function normalizePhoneE164(raw: string): string | null {
  const digits = extractDigits(raw);
  if (digits.length < 10 || digits.length > 15) return null;

  // 8XXXXXXXXXX или 7XXXXXXXXXX → +7XXXXXXXXXX (РФ-мобильные/городские)
  if (digits.length === 11 && (digits.startsWith('8') || digits.startsWith('7'))) {
    return `+7${digits.slice(1)}`;
  }
  // 9XXXXXXXXX (РФ-мобильный без кода страны) → +7 9XXXXXXXXX
  if (digits.length === 10 && digits.startsWith('9')) {
    return `+7${digits}`;
  }
  // Прочие: ≥10 цифр, считаем что пользователь сам ввёл country-code
  return `+${digits}`;
}

export const RegisterSchema = z.object({
  email: z.string().email('Невалидный email').max(254),
  name: z.string().trim().min(1, 'Имя обязательно').max(120),
  /**
   * Опциональный номер телефона. Принимаем в любом виде, нормализуем
   * в E.164. audit В8 — валидация: после очистки от не-цифр ≥10 цифр.
   */
  phone: z
    .string()
    .trim()
    .max(32, 'Телефон слишком длинный')
    .transform((v) => (v.length > 0 ? normalizePhoneE164(v) : null))
    .refine((v) => v === null || v.startsWith('+'), {
      message: 'Невалидный телефон: ожидается номер в формате +7XXXXXXXXXX',
    })
    .optional(),
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
