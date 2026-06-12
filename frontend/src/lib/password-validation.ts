/**
 * Валидация пароля на клиенте — синхронизирована с backend
 * `STRONG_PASSWORD_RX` из `dto/reset-password.dto.ts`.
 *
 * Правила: минимум 8 символов, минимум одна буква (любой алфавит) и одна
 * цифра. Серверный regex — источник правды; здесь — мягкая UX-проверка.
 */

const PASSWORD_RX = /^(?=.*[A-Za-zА-Яа-я])(?=.*\d).{8,}$/;

/**
 * #18 — ЕДИНЫЙ текст правила пароля. Показывается во всех формах (подсказка) и
 * возвращается при любой ошибке валидации. Раньше копи была размазана (разные
 * формулировки в SecuritySection / Onboarding / ResetPassword vs дробные
 * сообщения здесь) — теперь один источник правды.
 */
export const PASSWORD_RULE_HINT =
  'Минимум 8 символов, минимум одна буква и одна цифра.';

export interface PasswordValidationResult {
  valid: boolean;
  /** Локализованная причина при `valid=false` — всегда `PASSWORD_RULE_HINT`. */
  message?: string;
}

export function validatePassword(password: string): PasswordValidationResult {
  if (!password || password.length < 8 || !PASSWORD_RX.test(password)) {
    return { valid: false, message: PASSWORD_RULE_HINT };
  }
  return { valid: true };
}

export function passwordsMatch(a: string, b: string): boolean {
  return a.length > 0 && a === b;
}
